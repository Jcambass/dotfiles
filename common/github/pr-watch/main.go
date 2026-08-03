// pr-watch: an interactive Bubble Tea TUI for watching a set of GitHub PRs,
// plus headless flags for scripting/agent use (--add/--remove/--list/--once
// /--json), so this is the only PR-watching tool needed -- no separate
// scripting-only implementation.
//
// Interactive: pr-watch [ref ...] (persisted list if none given).
// Keys: up/down/j/k move, a add, d/x remove, r retry failed CI,
// f ask pi whether a failure looks caused by the PR or unrelated, o open in
// browser, q/ctrl+c quit.
//
// Headless: pr-watch --add/--remove/--list manage the persisted list
// (~/.config/pr-watch/list) without opening anything; --once/--json render
// a single snapshot instead of watching.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

const (
	defaultInterval = 30 * time.Second
	ghFields        = "number,title,url,state,isDraft,reviewDecision,headRefOid,statusCheckRollup"
)

var runIDPattern = regexp.MustCompile(`/runs/(\d+)`)

// ---------------------------------------------------------------------------
// Persisted list (shared format with the Python pr-watch)
// ---------------------------------------------------------------------------

func listFile() string {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "pr-watch", "list")
}

func loadList() []string {
	data, err := os.ReadFile(listFile())
	if err != nil {
		return nil
	}
	var refs []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		refs = append(refs, line)
	}
	return refs
}

func saveList(refs []string) error {
	if err := os.MkdirAll(filepath.Dir(listFile()), 0o755); err != nil {
		return err
	}
	var b strings.Builder
	for _, r := range refs {
		b.WriteString(r)
		b.WriteString("\n")
	}
	return os.WriteFile(listFile(), []byte(b.String()), 0o644)
}

// ---------------------------------------------------------------------------
// gh data model
// ---------------------------------------------------------------------------

type checkRun struct {
	Name         string `json:"name"`
	Context      string `json:"context"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion"`
	State        string `json:"state"`
	DetailsURL   string `json:"detailsUrl"`
	TargetURL    string `json:"targetUrl"`
	WorkflowName string `json:"workflowName"`
}

type ghPR struct {
	Number         int        `json:"number"`
	Title          string     `json:"title"`
	URL            string     `json:"url"`
	State          string     `json:"state"`
	IsDraft        bool       `json:"isDraft"`
	ReviewDecision string     `json:"reviewDecision"`
	HeadRefOid     string     `json:"headRefOid"`
	Checks         []checkRun `json:"statusCheckRollup"`
}

func normalizeRef(ref string) (display string, ghArgs []string, err error) {
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		return ref, []string{ref}, nil
	}
	if idx := strings.Index(ref, "#"); idx >= 0 {
		repo, num := ref[:idx], ref[idx+1:]
		return ref, []string{num, "-R", repo}, nil
	}
	if _, convErr := strconv.Atoi(ref); convErr == nil {
		out, cmdErr := exec.Command("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner").Output()
		if cmdErr != nil {
			return "", nil, fmt.Errorf("'%s' is a bare number but the current directory isn't a GitHub repo", ref)
		}
		repo := strings.TrimSpace(string(out))
		return repo + "#" + ref, []string{ref, "-R", repo}, nil
	}
	return "", nil, fmt.Errorf("unrecognized PR ref: %s", ref)
}

func rollupStatus(checks []checkRun) string {
	if len(checks) == 0 {
		return "none"
	}
	failing, pending := false, false
	for _, c := range checks {
		if isFailedCheck(c) {
			failing = true
			continue
		}
		if c.Status != "" && c.Status != "COMPLETED" {
			pending = true
		} else if c.State == "PENDING" || c.State == "EXPECTED" {
			pending = true
		}
	}
	if failing {
		return "failing"
	}
	if pending {
		return "pending"
	}
	return "passing"
}

var failConclusions = map[string]bool{
	"FAILURE": true, "CANCELLED": true, "TIMED_OUT": true,
	"ACTION_REQUIRED": true, "STARTUP_FAILURE": true,
}

// isFailedCheck reports whether a check (CheckRun or StatusContext) counts
// as failed, regardless of which kind it is.
func isFailedCheck(c checkRun) bool {
	return (c.Status == "COMPLETED" && failConclusions[c.Conclusion]) ||
		c.State == "FAILURE" || c.State == "ERROR"
}

// runIDOf extracts the Actions run id from a CheckRun's detailsUrl, if any.
func runIDOf(c checkRun) (string, bool) {
	m := runIDPattern.FindStringSubmatch(c.DetailsURL)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// runStillInProgress reports whether any check sharing the given run id
// hasn't completed yet -- gh refuses to rerun a run while it's still going
// ("cannot be rerun; This workflow is already running"), even if one job
// within it has already failed.
func runStillInProgress(checks []checkRun, runID string) bool {
	for _, c := range checks {
		id, ok := runIDOf(c)
		if !ok || id != runID {
			continue
		}
		if c.Status != "COMPLETED" {
			return true
		}
	}
	return false
}

func failedRunIDs(checks []checkRun) []string {
	seen := map[string]bool{}
	var ids []string
	for _, c := range checks {
		if !isFailedCheck(c) {
			continue
		}
		id, ok := runIDOf(c)
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

// rerunableRunIDs is the subset of failedRunIDs whose run has actually
// finished (gh run rerun --failed only works once the run is done, even
// though an individual job within it can fail while siblings are still
// running).
func rerunableRunIDs(checks []checkRun) []string {
	var ids []string
	for _, id := range failedRunIDs(checks) {
		if !runStillInProgress(checks, id) {
			ids = append(ids, id)
		}
	}
	return ids
}

// checkName returns a check's display name regardless of whether it's a
// CheckRun (name) or StatusContext (context).
func checkName(c checkRun) string {
	if c.Name != "" {
		return c.Name
	}
	return c.Context
}

// checkURL returns whichever URL field is populated (CheckRun's detailsUrl
// or StatusContext's targetUrl).
func checkURL(c checkRun) string {
	if c.DetailsURL != "" {
		return c.DetailsURL
	}
	return c.TargetURL
}

type checkAction string

const (
	actionPass     checkAction = "pass"
	actionPending  checkAction = "pending"
	actionRetry    checkAction = "retry"    // failing, safe to rerun right now
	actionWait     checkAction = "wait"     // failing, run still in progress
	actionExternal checkAction = "external" // failing, not an Actions run at all
)

// checkDetail is the single source of truth for both the table's compact CI
// column and the detail pane's full breakdown -- computed once per fetch.
type checkDetail struct {
	Name     string
	Workflow string
	URL      string
	Required bool
	Action   checkAction
}

func buildCheckDetails(checks []checkRun, required map[string]bool) []checkDetail {
	details := make([]checkDetail, 0, len(checks))
	for _, c := range checks {
		d := checkDetail{
			Name:     checkName(c),
			Workflow: c.WorkflowName,
			URL:      checkURL(c),
			Required: required[checkName(c)],
		}
		switch {
		case isFailedCheck(c):
			id, hasRunID := runIDOf(c)
			switch {
			case !hasRunID:
				d.Action = actionExternal
			case runStillInProgress(checks, id):
				d.Action = actionWait
			default:
				d.Action = actionRetry
			}
		case (c.Status != "" && c.Status != "COMPLETED") || c.State == "PENDING" || c.State == "EXPECTED":
			d.Action = actionPending
		default:
			d.Action = actionPass
		}
		details = append(details, d)
	}
	return details
}

// tableCI derives the table's single compact CI column from check details:
// "ok" (nothing needs attention), "req" (a required check needs attention --
// retry, wait, or external/inspect), or "opt" (only non-required checks do).
// tableCI derives the table's single compact CI column from check details:
// "ok" (green, nothing to do), "req"/"opt" (red/yellow, a required or only
// optional check needs attention), or "wait" (blue, nothing has failed but
// checks are still running -- distinct from "ok" since it could still go
// either way, not something to look away from).
func tableCI(details []checkDetail) (label string, color int) {
	reqAttention, optAttention, pending := false, false, false
	for _, d := range details {
		switch d.Action {
		case actionPass:
			continue
		case actionPending:
			pending = true
		default:
			if d.Required {
				reqAttention = true
			} else {
				optAttention = true
			}
		}
	}
	switch {
	case reqAttention:
		return "req", colorRed
	case optAttention:
		return "opt", colorYellow
	case pending:
		return "wait", colorBlue
	default:
		return "ok", colorGreen
	}
}

// requiredCheckNames asks gh which checks are required on this PR (gh pr
// view's statusCheckRollup has no required flag of its own).
func requiredCheckNames(ref string) map[string]bool {
	result := map[string]bool{}
	_, ghArgs, err := normalizeRef(ref)
	if err != nil {
		return result
	}
	args := append([]string{"pr", "checks"}, ghArgs...)
	args = append(args, "--required", "--json", "name")
	out, err := exec.Command("gh", args...).Output()
	if err != nil {
		return result
	}
	var rows []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(out, &rows); err != nil {
		return result
	}
	for _, r := range rows {
		result[r.Name] = true
	}
	return result
}

func repoFromURL(url string) string {
	parts := strings.Split(url, "/")
	for i, p := range parts {
		if p == "github.com" && i+2 < len(parts) {
			return parts[i+1] + "/" + parts[i+2]
		}
	}
	return url
}

func stderrOf(err error) string {
	if ee, ok := err.(*exec.ExitError); ok {
		return string(ee.Stderr)
	}
	return err.Error()
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// ---------------------------------------------------------------------------
// AI failure analysis (replaces rerun-based flake detection)
// ---------------------------------------------------------------------------

type pr struct {
	ref      string
	repo     string
	data     *ghPR
	ci       string // coarse passing/failing/pending/none -- used for retry/analyze gating and JSON
	checks   []checkDetail
	errMsg   string
	retrying bool

	analyzing bool
	aiVerdict string // "pr-caused", "unrelated", "unclear"
	aiReason  string
	aiSha     string // commit sha the verdict was computed against
	lastSha   string
}

func fetchOne(ref string) *pr {
	display, ghArgs, err := normalizeRef(ref)
	if err != nil {
		return &pr{ref: ref, errMsg: err.Error()}
	}
	args := append([]string{"pr", "view"}, ghArgs...)
	args = append(args, "--json", ghFields)
	out, err := exec.Command("gh", args...).Output()
	if err != nil {
		msg := firstLine(stderrOf(err))
		if msg == "" {
			msg = "gh pr view failed"
		}
		return &pr{ref: display, errMsg: msg}
	}
	var data ghPR
	if err := json.Unmarshal(out, &data); err != nil {
		return &pr{ref: display, errMsg: "failed to parse gh output"}
	}
	required := requiredCheckNames(ref)
	return &pr{
		ref:    display,
		repo:   repoFromURL(data.URL),
		data:   &data,
		ci:     rollupStatus(data.Checks),
		checks: buildCheckDetails(data.Checks, required),
	}
}

// ---------------------------------------------------------------------------
// Bubble Tea model
// ---------------------------------------------------------------------------

type tickMsg time.Time
type fetchedMsg struct{ prs []*pr }
type retryDoneMsg struct {
	ref string
	err error
}
type analyzedMsg struct {
	ref     string
	verdict string
	reason  string
	sha     string
	err     error
}

type model struct {
	refs        []string
	persisted   bool
	prs         []*pr
	cursor      int
	lastRefresh time.Time
	interval    time.Duration
	width       int
	height      int

	adding bool
	input  textinput.Model

	status      string
	statusUntil time.Time

	headless bool // --once/--json render: no interactivity, no footer
	quitting bool
}

func newModel(refs []string, persisted bool, interval time.Duration) model {
	ti := textinput.New()
	ti.Placeholder = "owner/repo#123 or a PR URL"
	ti.CharLimit = 200
	return model{refs: refs, persisted: persisted, interval: interval, input: ti}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(fetchCmd(m.refs), tickCmd(m.interval))
}

func fetchCmd(refs []string) tea.Cmd {
	return func() tea.Msg {
		prs := make([]*pr, 0, len(refs))
		for _, ref := range refs {
			prs = append(prs, fetchOne(ref))
		}
		return fetchedMsg{prs: prs}
	}
}

func tickCmd(interval time.Duration) tea.Cmd {
	return tea.Tick(interval, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func retryCmd(ref, repo string, runIDs []string) tea.Cmd {
	return func() tea.Msg {
		var firstErr error
		for _, id := range runIDs {
			out, err := exec.Command("gh", "run", "rerun", id, "--failed", "-R", repo).CombinedOutput()
			if err != nil && firstErr == nil {
				firstErr = fmt.Errorf("%s", firstLine(string(out)))
			}
		}
		return retryDoneMsg{ref: ref, err: firstErr}
	}
}

// isCmux reports whether this process is running inside a cmux surface.
func isCmux() bool {
	return os.Getenv("CMUX_WORKSPACE_ID") != ""
}

func openCmd(url string) tea.Cmd {
	return func() tea.Msg {
		if isCmux() {
			if err := exec.Command("cmux", "browser", "open", url, "--focus", "true").Run(); err == nil {
				return nil
			}
			// fall through to gh if cmux's browser command failed for any reason
		}
		_ = exec.Command("gh", "pr", "view", url, "--web").Start()
		return nil
	}
}

func (m *model) setStatus(s string) {
	m.status = s
	m.statusUntil = time.Now().Add(6 * time.Second)
}

func (m *model) findPR(ref string) *pr {
	for _, p := range m.prs {
		if p.ref == ref {
			return p
		}
	}
	return nil
}

// applyAction runs one named action against the model. Shared by keyboard
// shortcuts and clickable footer buttons so both paths behave identically.
func (m *model) applyAction(action string) tea.Cmd {
	switch action {
	case "quit":
		m.quitting = true
		return tea.Quit
	case "up":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down":
		if m.cursor < len(m.prs)-1 {
			m.cursor++
		}
	case "add":
		m.adding = true
		m.input.Focus()
		return textinput.Blink
	case "remove":
		if m.cursor < len(m.refs) {
			ref := m.refs[m.cursor]
			m.refs = append(m.refs[:m.cursor], m.refs[m.cursor+1:]...)
			m.prs = removePR(m.prs, ref)
			if m.cursor >= len(m.refs) && m.cursor > 0 {
				m.cursor--
			}
			_ = saveList(m.refs)
			m.setStatus("removed " + ref)
		}
	case "retry":
		if m.cursor >= len(m.prs) {
			return nil
		}
		p := m.prs[m.cursor]
		if p.data == nil || p.ci != "failing" {
			m.setStatus("no failing checks to retry for " + p.ref)
			return nil
		}
		ids := rerunableRunIDs(p.data.Checks)
		if len(ids) == 0 {
			if len(failedRunIDs(p.data.Checks)) > 0 {
				m.setStatus(p.ref + "'s failing run is still going -- can't rerun until it finishes")
			} else {
				m.setStatus("nothing rerunable for " + p.ref + " (external check, or no run id)")
			}
			return nil
		}
		p.retrying = true
		m.setStatus("re-running failed checks on " + p.ref + "…")
		return retryCmd(p.ref, p.repo, ids)
	case "analyze":
		if m.cursor >= len(m.prs) {
			return nil
		}
		p := m.prs[m.cursor]
		if p.data == nil || p.ci != "failing" {
			m.setStatus("no failing checks to analyze for " + p.ref)
			return nil
		}
		p.analyzing = true
		m.setStatus("asking pi whether " + p.ref + "'s failure looks related to the PR…")
		return analyzeCmd(p)
	case "open":
		if m.cursor < len(m.prs) && m.prs[m.cursor].data != nil {
			return openCmd(m.prs[m.cursor].data.URL)
		}
	}
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		if m.adding {
			switch msg.String() {
			case "enter":
				value := strings.TrimSpace(m.input.Value())
				m.adding = false
				m.input.Blur()
				m.input.SetValue("")
				if value == "" {
					return m, nil
				}
				added := false
				for _, ref := range strings.Fields(value) {
					if !contains(m.refs, ref) {
						m.refs = append(m.refs, ref)
						added = true
					}
				}
				if added {
					_ = saveList(m.refs)
					m.setStatus("added, refreshing…")
					return m, fetchCmd(m.refs)
				}
				return m, nil
			case "esc":
				m.adding = false
				m.input.Blur()
				m.input.SetValue("")
				return m, nil
			}
			var cmd tea.Cmd
			m.input, cmd = m.input.Update(msg)
			return m, cmd
		}

		switch msg.String() {
		case "ctrl+c", "q":
			return m, m.applyAction("quit")
		case "up", "k":
			return m, m.applyAction("up")
		case "down", "j":
			return m, m.applyAction("down")
		case "a":
			return m, m.applyAction("add")
		case "d", "x":
			return m, m.applyAction("remove")
		case "r":
			return m, m.applyAction("retry")
		case "f":
			return m, m.applyAction("analyze")
		case "o":
			return m, m.applyAction("open")
		}
		return m, nil

	case tea.MouseMsg:
		if msg.Action != tea.MouseActionPress || msg.Button != tea.MouseButtonLeft {
			return m, nil
		}
		if m.adding {
			return m, nil
		}
		rowCount := len(m.prs)
		if msg.Y == footerLineForRowCount(rowCount, len(computeDetailLines(m))) {
			_, zones := buttonRow()
			for _, z := range zones {
				if msg.X >= z.start && msg.X < z.end {
					return m, m.applyAction(z.action)
				}
			}
			return m, nil
		}
		if rowCount > 0 {
			firstRowLine := tableRowLine(0)
			lastRowLine := tableRowLine(rowCount - 1)
			if msg.Y >= firstRowLine && msg.Y <= lastRowLine {
				if idx := msg.Y - firstRowLine; idx >= 0 && idx < rowCount {
					m.cursor = idx
				}
			}
		}
		return m, nil

	case tickMsg:
		refs := m.refs
		if m.persisted {
			refs = loadList()
			m.refs = refs
		}
		return m, tea.Batch(fetchCmd(refs), tickCmd(m.interval))

	case fetchedMsg:
		byRef := map[string]*pr{}
		for _, p := range m.prs {
			byRef[p.ref] = p
		}
		currentRefs := map[string]bool{}
		for _, r := range m.refs {
			currentRefs[r] = true
		}
		kept := make([]*pr, 0, len(msg.prs))
		for _, np := range msg.prs {
			if !currentRefs[np.ref] {
				// Stale result for a ref that was removed while this fetch was
				// in flight -- drop it instead of resurrecting it.
				continue
			}
			old, existed := byRef[np.ref]
			if !existed {
				kept = append(kept, np)
				continue
			}
			sha := ""
			if np.data != nil {
				sha = np.data.HeadRefOid
			}
			if old.lastSha != "" && sha != "" && sha != old.lastSha {
				// New commit landed: any AI verdict about the old failure is stale.
				np.aiVerdict = ""
				np.aiReason = ""
			} else {
				np.aiVerdict = old.aiVerdict
				np.aiReason = old.aiReason
				np.aiSha = old.aiSha
				np.analyzing = old.analyzing
			}
			if old.retrying && np.ci != "pending" {
				np.retrying = false
			} else {
				np.retrying = old.retrying
			}
			np.lastSha = sha
			kept = append(kept, np)
		}
		m.prs = kept
		if m.cursor >= len(m.prs) {
			m.cursor = max(0, len(m.prs)-1)
		}
		m.lastRefresh = time.Now()
		return m, nil

	case retryDoneMsg:
		if msg.err != nil {
			m.setStatus("retry failed for " + msg.ref + ": " + msg.err.Error())
		} else {
			m.setStatus("retry triggered for " + msg.ref + ", waiting for checks…")
		}
		return m, nil

	case analyzedMsg:
		p := m.findPR(msg.ref)
		if p != nil {
			p.analyzing = false
		}
		if msg.err != nil {
			m.setStatus("analysis failed for " + msg.ref + ": " + msg.err.Error())
			return m, nil
		}
		if p != nil {
			p.aiVerdict = msg.verdict
			p.aiReason = msg.reason
			p.aiSha = msg.sha
		}
		m.setStatus(msg.ref + ": " + msg.verdict + " -- " + msg.reason)
		return m, nil
	}
	return m, nil
}

func removePR(prs []*pr, ref string) []*pr {
	out := make([]*pr, 0, len(prs))
	for _, p := range prs {
		if p.ref != ref {
			out = append(out, p)
		}
	}
	return out
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const (
	ansiReset   = "\x1b[0m"
	ansiFgReset = "\x1b[39m"
	ansiAttrOff = "\x1b[22m" // turns off bold and dim
	ansiBold    = "\x1b[1m"
	ansiDim     = "\x1b[2m"
)

const (
	colorGreen  = 2
	colorRed    = 1
	colorYellow = 3
	colorGray   = 8
	colorBlue   = 4
	colorLink   = 6
	bgSelected  = 238
)

// fg wraps text in a foreground color, resetting only the foreground
// afterward (never a full reset), so it composes safely inside an outer
// row background highlight.
func fg(code int, text string) string {
	return fmt.Sprintf("\x1b[38;5;%dm%s%s", code, text, ansiFgReset)
}

// linkStyle gives text an underlined, colored "this is a link" look, for use
// inside a hyperlink() wrapper -- most terminals don't style OSC 8 links on
// their own.
func linkStyle(text string) string {
	return fmt.Sprintf("\x1b[38;5;%dm\x1b[4m%s\x1b[24m%s", colorLink, text, ansiFgReset)
}

func dimText(text string) string {
	return ansiDim + text + ansiAttrOff
}

func boldText(text string) string {
	return ansiBold + text + ansiAttrOff
}

// wrapRow highlights an entire rendered line for the selected row. Cell
// colors inside must use fg()/dimText()/boldText() (attribute-only resets),
// never a raw \x1b[0m, so the background set here survives until the
// closing ansiReset.
func wrapRow(line string, selected bool) string {
	if !selected {
		return line
	}
	return fmt.Sprintf("\x1b[48;5;%dm%s%s", bgSelected, line, ansiReset)
}

func hyperlink(text, url string) string {
	return "\x1b]8;;" + url + "\x1b\\" + text + "\x1b]8;;\x1b\\"
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}

func truncate(s string, width int) string {
	if len(s) <= width {
		return s
	}
	if width <= 1 {
		return s[:width]
	}
	return s[:width-1] + "…"
}

func reviewBadge(decision string) (string, int) {
	switch decision {
	case "APPROVED":
		return "approved", colorGreen
	case "CHANGES_REQUESTED":
		return "changes", colorRed
	case "REVIEW_REQUIRED":
		return "pending", colorYellow
	default:
		return "-", colorGray
	}
}

func relativeTime(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	d := time.Since(t).Round(time.Second)
	if d < time.Second {
		return "just now"
	}
	return d.String() + " ago"
}

// ---------------------------------------------------------------------------
// Layout: shared between View() (rendering) and mouse-click handling, so
// click coordinates always match what's actually on screen.
// ---------------------------------------------------------------------------

const headerLines = 3 // title line, blank line, column header line

type buttonZone struct {
	action string
	start  int
	end    int
}

var buttonDefs = []struct{ label, action string }{
	{"a add", "add"},
	{"d remove", "remove"},
	{"r retry", "retry"},
	{"f explain", "analyze"},
	{"o open", "open"},
	{"q quit", "quit"},
}

// buttonRow returns the plain-text button row and each button's column
// range within it. Zones are computed from plain text so that ANSI styling
// added afterward never shifts click coordinates.
func buttonRow() (string, []buttonZone) {
	var plain strings.Builder
	zones := make([]buttonZone, 0, len(buttonDefs))
	col := 0
	for i, d := range buttonDefs {
		if i > 0 {
			plain.WriteString("   ")
			col += 3
		}
		text := "[ " + d.label + " ]"
		zones = append(zones, buttonZone{action: d.action, start: col, end: col + len(text)})
		plain.WriteString(text)
		col += len(text)
	}
	return plain.String(), zones
}

func styledButtonRow() string {
	plain, zones := buttonRow()
	var b strings.Builder
	pos := 0
	for _, z := range zones {
		b.WriteString(dimText(plain[pos:z.start]))
		b.WriteString(dimText("[ ") + boldText(plain[z.start+2:z.end-2]) + dimText(" ]"))
		pos = z.end
	}
	b.WriteString(dimText(plain[pos:]))
	return b.String()
}

// tableRowLine returns the 0-based output line for PR row i (one line per
// row now that the URL line has been dropped in favor of a styled link).
func tableRowLine(rowIndex int) int {
	return headerLines + rowIndex
}

// footerLineForRowCount returns the 0-based output line of the button row,
// given how many table rows and detail-pane lines are rendered above it.
func footerLineForRowCount(rowCount, detailLineCount int) int {
	rowLines := rowCount
	if rowCount == 0 {
		rowLines = 1 // "(empty ...)" line
	}
	line := headerLines + rowLines + 1 // +1 for the blank line before detail/footer
	if detailLineCount > 0 {
		line += detailLineCount + 1 // detail lines + blank line before footer
	}
	return line
}

func selectedPR(m model) *pr {
	if m.cursor < 0 || m.cursor >= len(m.prs) {
		return nil
	}
	return m.prs[m.cursor]
}

func aiStale(p *pr) bool {
	return p.data != nil && p.aiSha != "" && p.aiSha != p.data.HeadRefOid
}

var checkActionLabel = map[checkAction]string{
	actionRetry:    "retry-ready",
	actionWait:     "waiting -- run still in progress",
	actionExternal: "external check -- no rerun available",
}

// renderDetail is the full breakdown for the selected PR: CI checks grouped
// by required/optional with per-check rerun status, and the persisted AI
// verdict/reason (not just a transient status line).
func renderDetail(p *pr, width int) []string {
	if p == nil {
		return nil
	}
	var lines []string

	if p.errMsg != "" {
		rule := "── " + p.ref + " "
		if width > len(rule) {
			rule += strings.Repeat("─", width-len(rule))
		}
		lines = append(lines, dimText(rule))
		lines = append(lines, fg(colorRed, truncate(p.errMsg, width)))
		return lines
	}
	if p.data == nil {
		return lines
	}

	title := fmt.Sprintf("%s#%d", p.repo, p.data.Number)
	rule := "── " + title + " "
	if width > len(rule) {
		rule += strings.Repeat("─", width-len(rule))
	}
	lines = append(lines, dimText(rule))

	state := strings.ToLower(p.data.State)
	if p.data.IsDraft && state == "open" {
		state = "draft"
	}
	reviewText, _ := reviewBadge(p.data.ReviewDecision)
	lines = append(lines, truncate(p.data.Title, width)+dimText("  ("+state+" \u00b7 "+reviewText+")"))

	var failing, pending, passing int
	var attention []string
	for _, c := range p.checks {
		switch c.Action {
		case actionPass:
			passing++
		case actionPending:
			pending++
		default:
			failing++
			reqLabel, reqColor := "optional", colorYellow
			if c.Required {
				reqLabel, reqColor = "required", colorRed
			}
			name := c.Name
			if c.URL != "" {
				name = hyperlink(name, c.URL)
			}
			line := fmt.Sprintf("  %s  %s  %s", fg(colorRed, "FAIL"), fg(reqColor, padRight(reqLabel, 9)), name)
			if c.Workflow != "" {
				line += dimText(" [" + c.Workflow + "]")
			}
			line += dimText(" -- " + checkActionLabel[c.Action])
			attention = append(attention, line)
		}
	}
	lines = append(lines, fmt.Sprintf("CI: %d failing \u00b7 %d pending \u00b7 %d passing", failing, pending, passing))
	if failing == 0 && pending > 0 {
		lines = append(lines, fg(colorBlue, "still running -- nothing to do yet, not the same as passing"))
	}
	const maxCheckLines = 6
	for i, l := range attention {
		if i >= maxCheckLines {
			lines = append(lines, dimText(fmt.Sprintf("  … +%d more", len(attention)-maxCheckLines)))
			break
		}
		lines = append(lines, l)
	}

	switch {
	case p.analyzing:
		lines = append(lines, fg(colorYellow, "AI: analyzing…"))
	case p.aiVerdict != "" && !aiStale(p):
		verdictColor := colorGray
		switch p.aiVerdict {
		case "pr-caused":
			verdictColor = colorRed
		case "unrelated":
			verdictColor = colorYellow
		}
		lines = append(lines, "AI: "+fg(verdictColor, p.aiVerdict))
		lines = append(lines, "  "+dimText(truncate(p.aiReason, max(width-2, 10))))
	case failing > 0:
		lines = append(lines, dimText("AI: press 'f' to ask whether this failure looks related to the PR"))
	}

	return lines
}

// computeDetailLines renders the selected PR's detail pane and caps it to
// whatever vertical room is left once the table, chrome, and footer are
// accounted for. Shared by View() (to render) and the mouse handler (to
// know where the footer/buttons actually land).
func computeDetailLines(m model) []string {
	width := m.width
	if width <= 0 {
		width = 100
	}
	lines := renderDetail(selectedPR(m), width)
	if len(lines) == 0 {
		return lines
	}

	maxLines := 12
	if m.height > 0 {
		rowLines := len(m.prs)
		if rowLines == 0 {
			rowLines = 1
		}
		reserved := headerLines + rowLines + 2 + 1 // chrome + table + 2 blanks + footer
		avail := m.height - reserved
		if avail < 0 {
			avail = 0
		}
		maxLines = avail
	}
	if len(lines) > maxLines {
		if maxLines <= 0 {
			return nil
		}
		lines = append(append([]string{}, lines[:maxLines-1]...), dimText("  … (resize terminal for more)"))
	}
	return lines
}

func (m model) View() string {
	if m.quitting {
		return ""
	}

	const idxW, prW, ciW, reviewW, stateW = 4, 32, 6, 10, 8
	width := m.width
	if width <= 0 {
		width = 100
	}
	titleW := width - idxW - prW - ciW - reviewW - stateW - 6
	if titleW < 20 {
		titleW = 20
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%s  %s\n\n",
		boldText(fmt.Sprintf("Watching %d PR(s)", len(m.prs))),
		dimText("updated "+relativeTime(m.lastRefresh)))

	header := fmt.Sprintf("%s%s %s %s %s TITLE",
		padRight("", idxW), padRight("PR", prW),
		padRight("CI", ciW), padRight("REVIEW", reviewW), padRight("STATE", stateW))
	b.WriteString(dimText(header))
	b.WriteString("\n")

	if len(m.prs) == 0 {
		b.WriteString(dimText("(empty -- press 'a' or click [ a add ] below)"))
		b.WriteString("\n")
	}

	for i, p := range m.prs {
		selected := i == m.cursor
		idx := padRight(fmt.Sprintf("%d.", i+1), idxW)

		if p.errMsg != "" {
			mainLine := fmt.Sprintf("%s%s %s", dimText(idx), padRight(p.ref, prW), fg(colorRed, truncate(p.errMsg, titleW)))
			b.WriteString(wrapRow(mainLine, selected))
			b.WriteString("\n")
			continue
		}

		prLabel := fmt.Sprintf("%s#%d", p.repo, p.data.Number)
		prCell := hyperlink(linkStyle(padRight(prLabel, prW)), p.data.URL)

		ciText, ciColor := tableCI(p.checks)
		ciCell := fg(ciColor, padRight(ciText, ciW))
		if p.retrying {
			ciCell = fg(colorYellow, padRight("…", ciW))
		}

		reviewText, reviewColor := reviewBadge(p.data.ReviewDecision)
		reviewCell := fg(reviewColor, padRight(reviewText, reviewW))

		state := strings.ToLower(p.data.State)
		if p.data.IsDraft && state == "open" {
			state = "draft"
		}
		var stateCell string
		switch state {
		case "open":
			stateCell = fg(colorGreen, padRight(state, stateW))
		case "merged":
			stateCell = boldText(padRight(state, stateW))
		case "closed":
			stateCell = dimText(padRight(state, stateW))
		default:
			stateCell = fg(colorGray, padRight(state, stateW))
		}

		title := truncate(p.data.Title, titleW)

		mainLine := fmt.Sprintf("%s%s %s %s %s %s",
			dimText(idx), prCell, ciCell, reviewCell, stateCell, title)

		b.WriteString(wrapRow(mainLine, selected))
		b.WriteString("\n")
	}

	detailLines := computeDetailLines(m)
	if len(detailLines) > 0 {
		b.WriteString("\n")
		for _, l := range detailLines {
			b.WriteString(l)
			b.WriteString("\n")
		}
	}

	b.WriteString("\n")
	if m.headless {
		// Headless render (--once/--json): no interactivity, no footer.
	} else if m.adding {
		b.WriteString("add ref: " + m.input.View())
	} else if m.status != "" && time.Now().Before(m.statusUntil) {
		b.WriteString(dimText(m.status))
	} else {
		b.WriteString(styledButtonRow())
		b.WriteString(dimText("   \u2191/\u2193 or click a row to select"))
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// Headless mode (no TTY/TUI needed) -- scripting, agent use, list management
// ---------------------------------------------------------------------------

type jsonCheck struct {
	Name     string `json:"name"`
	Workflow string `json:"workflow,omitempty"`
	URL      string `json:"url,omitempty"`
	Required bool   `json:"required"`
	Action   string `json:"action"` // pass/pending/retry/wait/external
}

type jsonRow struct {
	Ref            string      `json:"ref"`
	URL            string      `json:"url,omitempty"`
	Number         int         `json:"number,omitempty"`
	Title          string      `json:"title,omitempty"`
	State          string      `json:"state,omitempty"`
	IsDraft        bool        `json:"isDraft,omitempty"`
	ReviewDecision string      `json:"reviewDecision,omitempty"`
	CI             string      `json:"ci,omitempty"`
	TableCI        string      `json:"tableCi,omitempty"` // ok/req/opt, see tableCI()
	Checks         []jsonCheck `json:"checks,omitempty"`
	AIVerdict      string      `json:"aiVerdict,omitempty"`
	AIReason       string      `json:"aiReason,omitempty"`
	Error          string      `json:"error,omitempty"`
}

func printList(refs []string) {
	if len(refs) == 0 {
		fmt.Println("Watch list is empty. Add refs with: pr-watch --add <ref>")
		return
	}
	fmt.Printf("Watch list (%d):\n", len(refs))
	for _, r := range refs {
		fmt.Println("  " + r)
	}
}

func cmdAdd(newRefs []string) {
	current := loadList()
	for _, r := range newRefs {
		if !contains(current, r) {
			current = append(current, r)
		}
	}
	_ = saveList(current)
	printList(current)
}

func cmdRemove(removeRefs []string) {
	remove := map[string]bool{}
	for _, r := range removeRefs {
		remove[r] = true
	}
	var current []string
	for _, r := range loadList() {
		if !remove[r] {
			current = append(current, r)
		}
	}
	_ = saveList(current)
	printList(current)
}

func cmdList() {
	printList(loadList())
}

func fetchAll(refs []string) []*pr {
	prs := make([]*pr, 0, len(refs))
	for _, ref := range refs {
		prs = append(prs, fetchOne(ref))
	}
	return prs
}

func printJSON(prs []*pr) {
	rows := make([]jsonRow, 0, len(prs))
	for _, p := range prs {
		row := jsonRow{Ref: p.ref}
		if p.errMsg != "" {
			row.Error = p.errMsg
		} else if p.data != nil {
			row.URL = p.data.URL
			row.Number = p.data.Number
			row.Title = p.data.Title
			row.State = p.data.State
			row.IsDraft = p.data.IsDraft
			row.ReviewDecision = p.data.ReviewDecision
			row.CI = p.ci
			tableCIText, _ := tableCI(p.checks)
			row.TableCI = tableCIText
			for _, c := range p.checks {
				row.Checks = append(row.Checks, jsonCheck{
					Name: c.Name, Workflow: c.Workflow, URL: c.URL,
					Required: c.Required, Action: string(c.Action),
				})
			}
			if p.aiVerdict != "" && !aiStale(p) {
				row.AIVerdict = p.aiVerdict
				row.AIReason = p.aiReason
			}
		}
		rows = append(rows, row)
	}
	out, _ := json.MarshalIndent(rows, "", "  ")
	fmt.Println(string(out))
}

// headlessRender reuses the same table layout as the interactive TUI
// (model.View is a pure function of its fields), with no row selected.
func headlessRender(prs []*pr) string {
	cursor := -1
	if len(prs) == 1 {
		// Only one PR: showing its detail automatically is unambiguous and
		// more useful than a bare table for a quick one-off check.
		cursor = 0
	}
	m := model{prs: prs, cursor: cursor, headless: true, lastRefresh: time.Now(), quitting: false}
	return m.View()
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	var refs []string
	interval := defaultInterval
	once := false
	asJSON := false
	listOnly := false
	var addRefs, removeRefs []string
	sawAdd, sawRemove := false, false

	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--interval":
			if i+1 < len(args) {
				if n, err := strconv.Atoi(args[i+1]); err == nil {
					interval = time.Duration(n) * time.Second
				}
				i++
			}
		case "--once":
			once = true
		case "--json":
			asJSON = true
		case "--list":
			listOnly = true
		case "--add":
			sawAdd = true
			addRefs = append(addRefs, args[i+1:]...)
			i = len(args)
		case "--remove":
			sawRemove = true
			removeRefs = append(removeRefs, args[i+1:]...)
			i = len(args)
		default:
			refs = append(refs, args[i])
		}
	}

	if sawAdd {
		if len(addRefs) == 0 {
			fmt.Fprintln(os.Stderr, "Usage: pr-watch --add <ref> [<ref> ...]")
			os.Exit(1)
		}
		cmdAdd(addRefs)
		return
	}
	if sawRemove {
		if len(removeRefs) == 0 {
			fmt.Fprintln(os.Stderr, "Usage: pr-watch --remove <ref> [<ref> ...]")
			os.Exit(1)
		}
		cmdRemove(removeRefs)
		return
	}
	if listOnly {
		cmdList()
		return
	}

	persisted := len(refs) == 0
	if persisted {
		refs = loadList()
	}

	if once || asJSON {
		if len(refs) == 0 {
			fmt.Fprintln(os.Stderr, "No PRs to watch. Pass refs directly, or add some with: pr-watch --add <ref>")
			os.Exit(1)
		}
		prs := fetchAll(refs)
		if asJSON {
			printJSON(prs)
		} else {
			fmt.Println(headlessRender(prs))
		}
		return
	}

	m := newModel(refs, persisted, interval)
	p := tea.NewProgram(m, tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
