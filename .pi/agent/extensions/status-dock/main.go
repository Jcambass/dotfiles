package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type mode string

const (
	modeAll     mode = "all"
	modeSession mode = "session"
	modeTasks   mode = "tasks"
	modeGit     mode = "git"
)

type workspace struct {
	ID    string
	Ref   string
	Title string
	Cwd   string
}

type registry struct {
	Entries []entry `json:"entries"`
}

type entry struct {
	PID         int    `json:"pid"`
	Cwd         string `json:"cwd"`
	SessionDir  string `json:"sessionDir"`
	SessionFile string `json:"sessionFile"`
	WorkspaceID string `json:"workspaceId"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type stats struct {
	SessionName    string   `json:"sessionName"`
	Model          string   `json:"model"`
	ContextPercent *float64 `json:"contextPercent"`
	Compacted      bool     `json:"compacted"`
	InputTokens    int64    `json:"inputTokens"`
	OutputTokens   int64    `json:"outputTokens"`
	CacheRead      int64    `json:"cacheRead"`
	CacheWrite     int64    `json:"cacheWrite"`
	Cost           float64  `json:"cost"`
	Turns          int      `json:"turns"`
	Errors         int      `json:"errors"`
	State          string   `json:"state"`
	FilesEdited    []string `json:"filesEdited"`
	FilesCreated   []string `json:"filesCreated"`
	CommandsRun    int      `json:"commandsRun"`
	Subagent       *struct {
		Mode      string   `json:"mode"`
		Agents    []string `json:"agents"`
		Completed int      `json:"completed"`
		Total     int      `json:"total"`
	} `json:"subagent"`
}

type todoData struct {
	Goal  *goal  `json:"goal"`
	Tasks []task `json:"tasks"`
}

type goal struct {
	Objective string `json:"objective"`
	Status    string `json:"status"`
	Note      string `json:"note"`
}

type task struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type tickMsg time.Time

type model struct {
	mode     mode
	vp       viewport.Model
	ready    bool
	width    int
	height   int
	lastBody string
}

var (
	bold      = lipgloss.NewStyle().Bold(true)
	dim       = lipgloss.NewStyle().Foreground(lipgloss.Color("246"))
	gray      = lipgloss.NewStyle().Foreground(lipgloss.Color("248"))
	border    = lipgloss.NewStyle().Foreground(lipgloss.Color("#3b4252"))
	sage      = lipgloss.NewStyle().Foreground(lipgloss.Color("114"))
	butter    = lipgloss.NewStyle().Foreground(lipgloss.Color("228"))
	soft      = lipgloss.NewStyle().Foreground(lipgloss.Color("247"))
	paleCyan  = lipgloss.NewStyle().Foreground(lipgloss.Color("159"))
	paleAmber = lipgloss.NewStyle().Foreground(lipgloss.Color("223"))
	paleRose  = lipgloss.NewStyle().Foreground(lipgloss.Color("217"))
	blue      = lipgloss.NewStyle().Foreground(lipgloss.Color("34"))
	cyan      = lipgloss.NewStyle().Foreground(lipgloss.Color("36"))
	magenta   = lipgloss.NewStyle().Foreground(lipgloss.Color("35"))
	red       = lipgloss.NewStyle().Foreground(lipgloss.Color("31"))
	pad       = lipgloss.NewStyle().PaddingLeft(1)
)

func main() {
	m := modeAll
	if len(os.Args) > 1 {
		switch mode(os.Args[1]) {
		case modeAll, modeSession, modeTasks, modeGit:
			m = mode(os.Args[1])
		}
	}
	p := tea.NewProgram(model{mode: m}, tea.WithAltScreen(), tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func (m model) Init() tea.Cmd { return tick() }

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		if !m.ready {
			m.vp = viewport.New(msg.Width, msg.Height)
			m.ready = true
		} else {
			m.vp.Width = msg.Width
			m.vp.Height = msg.Height
		}
		m.lastBody = render(m.mode, m.width)
		m.vp.SetContent(m.lastBody)
	case tickMsg:
		m.lastBody = render(m.mode, m.width)
		oldYOffset := m.vp.YOffset
		m.vp.SetContent(m.lastBody)
		m.vp.YOffset = min(oldYOffset, max(0, m.vp.TotalLineCount()-m.vp.Height))
		return m, tick()
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
	}
	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return m, cmd
}

func (m model) View() string {
	if !m.ready {
		return ""
	}
	return m.vp.View()
}

func render(m mode, width int) string {
	if width <= 0 {
		width = 80
	}
	ws := selectedWorkspace()
	ent := selectedEntry(ws)
	b := &builder{width: width, content: max(20, width-2)}
	switch m {
	case modeAll:
		renderSession(b, ws, ent)
		renderTasks(b, ws, ent)
		renderGit(b, ws)
	case modeSession:
		renderSession(b, ws, ent)
	case modeTasks:
		renderTasks(b, ws, ent)
	case modeGit:
		renderGit(b, ws)
	}
	return b.String()
}

type builder struct {
	width   int
	content int
	lines   []string
}

func (b *builder) p(s string) { b.lines = append(b.lines, pad.Render(s)) }
func (b *builder) blank()     { b.lines = append(b.lines, "") }
func (b *builder) hr()        { b.p(border.Render(strings.Repeat("─", b.content))) }
func (b *builder) section(title string, indicator string) {
	b.blank()
	b.hr()
	line := bold.Render(title)
	if indicator != "" {
		line += " " + indicator
	}
	b.p(line)
	b.hr()
	b.blank()
}
func (b *builder) wrap(s string, prefix string, style lipgloss.Style) {
	available := max(8, b.content-lipgloss.Width(prefix))
	for i, line := range wordWrap(clean(s), available) {
		pfx := strings.Repeat(" ", lipgloss.Width(prefix))
		if i == 0 {
			pfx = prefix
		}
		b.p(pfx + style.Render(line))
	}
}
func (b *builder) String() string { return strings.Join(b.lines, "\n") }

func selectedWorkspace() workspace {
	if raw := run("", "cmux", "rpc", "extension.sidebar.snapshot", "{}"); raw != "" {
		var snap struct {
			SelectedWorkspaceID  string `json:"selected_workspace_id"`
			SelectedWorkspaceRef string `json:"selected_workspace_ref"`
			Workspaces           []struct {
				ID               string `json:"id"`
				Title            string `json:"title"`
				CurrentDirectory string `json:"current_directory"`
				RootPath         string `json:"root_path"`
			} `json:"workspaces"`
		}
		if json.Unmarshal([]byte(raw), &snap) == nil {
			for _, w := range snap.Workspaces {
				if w.ID == snap.SelectedWorkspaceID {
					cwd := firstNonEmpty(w.CurrentDirectory, w.RootPath, mustCwd())
					return workspace{ID: snap.SelectedWorkspaceID, Ref: snap.SelectedWorkspaceRef, Title: firstNonEmpty(w.Title, filepath.Base(cwd)), Cwd: cwd}
				}
			}
		}
	}
	if raw := run("", "cmux", "current-workspace", "--json"); raw != "" {
		var cw struct {
			Workspace struct {
				Title            string `json:"title"`
				CurrentDirectory string `json:"current_directory"`
				Ref              string `json:"ref"`
			} `json:"workspace"`
		}
		if json.Unmarshal([]byte(raw), &cw) == nil {
			cwd := firstNonEmpty(cw.Workspace.CurrentDirectory, mustCwd())
			return workspace{Title: firstNonEmpty(cw.Workspace.Title, filepath.Base(cwd)), Cwd: cwd, Ref: cw.Workspace.Ref}
		}
	}
	cwd := mustCwd()
	return workspace{Title: filepath.Base(cwd), Cwd: cwd}
}

func selectedEntry(ws workspace) *entry {
	entries := registryEntries()
	cwdReal, _ := filepath.EvalSymlinks(ws.Cwd)
	if cwdReal == "" {
		cwdReal = ws.Cwd
	}
	var idMatches, cwdMatches []entry
	for _, e := range entries {
		if e.PID == 0 || e.Cwd == "" {
			continue
		}
		if !alive(e.PID) && !entryHasState(e) {
			continue
		}
		if ws.ID != "" && e.WorkspaceID == ws.ID {
			idMatches = append(idMatches, e)
			continue
		}
		er, _ := filepath.EvalSymlinks(e.Cwd)
		if er == "" {
			er = e.Cwd
		}
		if er == cwdReal {
			cwdMatches = append(cwdMatches, e)
		}
	}
	matches := idMatches
	if len(matches) == 0 {
		matches = cwdMatches
	}
	if len(matches) == 0 {
		return nil
	}
	sort.Slice(matches, func(i, j int) bool {
		ai, aj := alive(matches[i].PID), alive(matches[j].PID)
		if ai != aj {
			return ai
		}
		return matches[i].UpdatedAt > matches[j].UpdatedAt
	})
	return &matches[0]
}

func registryEntries() []entry {
	path := filepath.Join(os.TempDir(), "pi-status-registry.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var reg registry
	if json.Unmarshal(data, &reg) != nil {
		return nil
	}
	return reg.Entries
}

func entryHasState(e entry) bool {
	if e.PID == 0 || e.SessionDir == "" {
		return false
	}
	_, statErr := os.Stat(filepath.Join(e.SessionDir, fmt.Sprintf("%d-stats.json", e.PID)))
	_, todoErr := os.Stat(filepath.Join(e.SessionDir, fmt.Sprintf("%d-todos.json", e.PID)))
	return statErr == nil || todoErr == nil
}

func readStats(e *entry) *stats {
	if e == nil {
		return nil
	}
	var s stats
	if readJSON(filepath.Join(e.SessionDir, fmt.Sprintf("%d-stats.json", e.PID)), &s) != nil {
		return nil
	}
	return &s
}

func readTodos(e *entry) *todoData {
	if e == nil {
		return nil
	}
	var t todoData
	if readJSON(filepath.Join(e.SessionDir, fmt.Sprintf("%d-todos.json", e.PID)), &t) != nil {
		return nil
	}
	return &t
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func renderSession(b *builder, ws workspace, e *entry) {
	if e == nil {
		renderNoPi(b, ws)
		return
	}
	s := readStats(e)
	if s == nil {
		renderNoPi(b, ws)
		return
	}
	state := firstNonEmpty(s.State, "idle")
	indicator := soft.Render("· · ·")
	if state == "working" {
		indicator = butter.Render("• • •")
	} else if state == "error" {
		indicator = paleRose.Render("✗")
	}
	b.section("Session", indicator)
	if s.SessionName != "" {
		b.wrap(s.SessionName, paleCyan.Render("Name "), bold)
	} else {
		b.p(dim.Render("Name unnamed"))
	}
	if s.Model != "" {
		b.p(gray.Render(truncate(s.Model, b.content)))
	}
	if s.ContextPercent != nil {
		b.blank()
		b.p(percentBar(*s.ContextPercent, max(8, min(28, b.content-16))) + fmt.Sprintf(" %.0f%%", *s.ContextPercent))
		b.blank()
	}
	line := fmt.Sprintf("↑%.1fk ↓%.1fk", float64(s.InputTokens)/1000, float64(s.OutputTokens)/1000)
	if s.CacheRead > 0 {
		line += fmt.Sprintf(" R%.1fk", float64(s.CacheRead)/1000)
	}
	if s.CacheWrite > 0 {
		line += fmt.Sprintf(" W%.1fk", float64(s.CacheWrite)/1000)
	}
	if s.Cost > 0 {
		line += fmt.Sprintf("  $%.3f", s.Cost)
	}
	if s.Turns > 0 {
		line += fmt.Sprintf("  %d turns", s.Turns)
	}
	if s.Compacted {
		line += "  ⚑ compacted"
	}
	b.p(gray.Render(line))
	if s.Subagent != nil {
		b.p(magenta.Render(fmt.Sprintf("↳ Agents %d/%d %s", s.Subagent.Completed, s.Subagent.Total, s.Subagent.Mode)))
	}
	changed := len(s.FilesEdited) + len(s.FilesCreated)
	if changed > 0 || s.CommandsRun > 0 {
		b.p(gray.Render(fmt.Sprintf("Work: %d files · %d commands", changed, s.CommandsRun)))
	}
}

func renderTasks(b *builder, ws workspace, e *entry) {
	if e == nil {
		renderNoPi(b, ws)
		return
	}
	t := readTodos(e)
	if t == nil {
		t = &todoData{}
	}
	if plan := planSummary(ws.Cwd); plan != nil {
		b.section("Plan", "")
		b.wrap(plan.Title, blue.Render("◇ "), lipgloss.NewStyle())
		b.p(gray.Render(truncate(plan.Path, b.content)))
	}
	if t.Goal != nil {
		b.section("Goal", "")
		icons := map[string]string{"active": "●", "paused": "◌", "blocked": "▲", "complete": "✓"}
		colors := map[string]lipgloss.Style{"active": paleCyan, "paused": soft, "blocked": paleAmber, "complete": sage}
		st := firstNonEmpty(t.Goal.Status, "active")
		b.wrap(t.Goal.Objective, colors[st].Render(firstNonEmpty(icons[st], "●"))+" ", lipgloss.NewStyle())
		if t.Goal.Note != "" {
			b.blank()
			b.wrap(t.Goal.Note, "  ", dim)
		}
	}
	b.section("Tasks", "")
	if len(t.Tasks) == 0 {
		b.p(dim.Render("No active tasks."))
		return
	}
	done, activeCount := 0, 0
	for i := range t.Tasks {
		switch t.Tasks[i].Status {
		case "completed", "cancelled":
			done++
		case "in_progress":
			activeCount++
		}
	}
	b.p(taskBar(done, len(t.Tasks), activeCount, max(8, min(28, b.content-12))) + fmt.Sprintf(" %d/%d", done, len(t.Tasks)))
	b.blank()
	for i, task := range t.Tasks {
		icon, style := taskIcon(task.Status)
		b.wrap(task.Title, style.Render(icon)+" ", lipgloss.NewStyle())
		if i < len(t.Tasks)-1 {
			b.blank()
		}
	}
}

type planInfo struct{ Title, Path string }

func planSummary(cwd string) *planInfo {
	for dir := cwd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, ".pi", "plan.md")
		if data, err := os.ReadFile(candidate); err == nil {
			title := "plan.md"
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "#") {
					title = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(strings.TrimLeft(line, "#")), "Plan:"))
					if title == "" {
						title = "plan.md"
					}
					break
				}
			}
			return &planInfo{Title: title, Path: candidate}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	return nil
}

func renderGit(b *builder, ws workspace) {
	b.section("Git", "")
	if run(ws.Cwd, "git", "rev-parse", "--is-inside-work-tree") != "true" {
		b.p(dim.Render("Not a git repository."))
		return
	}
	root := firstNonEmpty(run(ws.Cwd, "git", "rev-parse", "--show-toplevel"), ws.Cwd)
	branch := firstNonEmpty(run(ws.Cwd, "git", "branch", "--show-current"), "detached")
	suffix := ""
	if ab := run(ws.Cwd, "git", "rev-list", "--left-right", "--count", fmt.Sprintf("origin/%s...HEAD", branch)); ab != "" {
		parts := strings.Fields(ab)
		if len(parts) == 2 {
			if parts[1] != "0" {
				suffix += " ↑" + parts[1]
			}
			if parts[0] != "0" {
				suffix += " ↓" + parts[0]
			}
		}
	}
	b.p(cyan.Render("⎇") + " " + bold.Render(branch+suffix))
	b.p(gray.Render("⌂ " + truncate(root, b.content-3)))
	b.blank()
	status := run(ws.Cwd, "git", "status", "--porcelain")
	rows := []string{}
	if status != "" {
		rows = strings.Split(status, "\n")
	}
	if len(rows) == 0 {
		b.p(sage.Render("No changes"))
		return
	}
	b.p(paleAmber.Render(fmt.Sprintf("%d changed files", len(rows))))
	b.blank()
	for _, row := range rows {
		if row == "" {
			continue
		}
		code := row[:min(2, len(row))]
		file := ""
		if len(row) > 3 {
			file = row[3:]
		}
		marker := strings.TrimSpace(code)
		if marker == "" {
			marker = "?"
		}
		style := butter
		if strings.Contains(code, "D") {
			style = red
		} else if strings.Contains(code, "A") || strings.Contains(code, "?") {
			style = sage
		}
		b.p(style.Render(fmt.Sprintf("%2s", marker)) + " " + truncate(file, b.content-5))
	}
}

func renderNoPi(b *builder, ws workspace) {
	b.section("Pi", "")
	b.p(paleAmber.Render("No active Pi session for this workspace."))
	b.wrap(ws.Cwd, gray.Render("⌂ "), lipgloss.NewStyle())
	if ws.ID != "" {
		b.p(dim.Render("workspace " + ws.ID))
	}
	b.blank()
	b.wrap("Start or reload Pi in this workspace to publish status.", "", lipgloss.NewStyle())
}

func taskIcon(status string) (string, lipgloss.Style) {
	switch status {
	case "in_progress":
		return "▸", butter
	case "completed":
		return "✓", sage
	case "cancelled":
		return "✗", dim
	default:
		return "○", soft
	}
}

func percentBar(pct float64, n int) string {
	pct = maxFloat(0, minFloat(100, pct))
	filled := int((pct * float64(n) / 100) + 0.5)
	style := paleCyan
	if pct > 90 {
		style = paleRose
	} else if pct > 70 {
		style = paleAmber
	}
	return style.Render(strings.Repeat("█", filled)) + soft.Render(strings.Repeat("░", max(0, n-filled)))
}

func taskBar(done, total, active, n int) string {
	if total <= 0 {
		total = 1
	}
	doneW := int((float64(done) * float64(n) / float64(total)) + 0.5)
	activeW := int((float64(done+active)*float64(n)/float64(total))+0.5) - doneW
	empty := max(0, n-doneW-activeW)
	return sage.Render(strings.Repeat("█", doneW)) + butter.Render(strings.Repeat("█", max(0, activeW))) + soft.Render(strings.Repeat("░", empty))
}

func wordWrap(s string, width int) []string {
	s = clean(s)
	if s == "" {
		return []string{""}
	}
	var lines []string
	for _, para := range strings.Split(s, "\n") {
		words := strings.Fields(para)
		line := ""
		for _, w := range words {
			if line == "" {
				line = w
			} else if len(line)+1+len(w) <= width {
				line += " " + w
			} else {
				lines = append(lines, line)
				line = w
			}
		}
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return []string{""}
	}
	return lines
}

func run(cwd string, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func clean(s string) string { return strings.Join(strings.Fields(s), " ") }
func truncate(s string, n int) string {
	s = clean(s)
	if len(s) <= n {
		return s
	}
	return s[:max(0, n-1)] + "…"
}
func mustCwd() string { cwd, _ := os.Getwd(); return cwd }
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
func parseInt(s string) int { v, _ := strconv.Atoi(s); return v }
