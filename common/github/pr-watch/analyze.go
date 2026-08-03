package main

import (
	"fmt"
	"os/exec"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

const (
	maxLogChars  = 6000
	maxDiffChars = 6000
)

// truncateForPrompt keeps the tail of s, where the actual failure usually
// is, instead of the head.
func truncateForPrompt(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}

// fetchFailedLogs pulls the failed-step logs for each Actions run behind a
// PR's failing checks.
func fetchFailedLogs(repo string, runIDs []string) string {
	var b strings.Builder
	for _, id := range runIDs {
		out, _ := exec.Command("gh", "run", "view", id, "--log-failed", "-R", repo).CombinedOutput()
		fmt.Fprintf(&b, "--- run %s ---\n%s\n", id, truncateForPrompt(string(out), maxLogChars))
	}
	return b.String()
}

// summarizeFailingChecks describes every failing check, Actions-run or not
// (e.g. external StatusContext checks like a merge-stop-enforcer bot have no
// run id or log to fetch, but their name/context is still useful context).
func summarizeFailingChecks(checks []checkRun) string {
	var b strings.Builder
	for _, c := range checks {
		if !isFailedCheck(c) {
			continue
		}
		switch {
		case c.Status != "":
			fmt.Fprintf(&b, "- CheckRun %q (workflow %q): conclusion=%s, url=%s\n", c.Name, c.WorkflowName, c.Conclusion, c.DetailsURL)
		case c.State != "":
			fmt.Fprintf(&b, "- StatusContext %q: state=%s, url=%s (external check, no fetchable log)\n", c.Context, c.State, c.TargetURL)
		}
	}
	return b.String()
}

// analyzeCmd asks a fresh, tool-less `pi` session -- the same way you'd
// manually ask an agent to look at a CI failure -- whether it looks caused
// by the PR's own changes, or unrelated/flaky/pre-existing, instead of
// empirically re-running CI to find out.
func analyzeCmd(p *pr) tea.Cmd {
	return func() tea.Msg {
		if p.data == nil {
			return analyzedMsg{ref: p.ref, err: fmt.Errorf("no data for %s", p.ref)}
		}
		sha := p.data.HeadRefOid

		summary := summarizeFailingChecks(p.data.Checks)
		runIDs := failedRunIDs(p.data.Checks)
		logs := "(no Actions run logs available for the failing check(s) -- see the summary above)"
		if len(runIDs) > 0 {
			logs = fetchFailedLogs(p.repo, runIDs)
		}

		diffOut, _ := exec.Command("gh", "pr", "diff", p.ref).CombinedOutput()
		diff := truncateForPrompt(string(diffOut), maxDiffChars)

		var prompt strings.Builder
		fmt.Fprintf(&prompt, "A CI check is failing on PR %s (\"%s\").\n\n", p.ref, p.data.Title)
		prompt.WriteString("Given the PR's diff and the failing check details below, decide whether the ")
		prompt.WriteString("failure looks CAUSED BY this PR's own changes, or looks UNRELATED/flaky/pre-existing ")
		prompt.WriteString("(infra issue, timeout, dependency, test order, environment, external status check, etc.) -- ")
		prompt.WriteString("the same judgment call you'd make if asked to look at a failing check manually.\n\n")
		prompt.WriteString("Respond in exactly this format, nothing else:\n")
		prompt.WriteString("VERDICT: <one of: pr-caused, unrelated, unclear>\n")
		prompt.WriteString("REASON: <one line, under 100 characters>\n\n")
		fmt.Fprintf(&prompt, "--- Failing checks ---\n%s\n", summary)
		fmt.Fprintf(&prompt, "--- PR diff (may be truncated) ---\n%s\n\n", diff)
		fmt.Fprintf(&prompt, "--- Failing check logs (tail, may be truncated) ---\n%s\n", logs)

		out, err := exec.Command("pi", "-p", prompt.String(),
			"--no-tools", "--no-session", "--no-extensions", "--no-skills", "--no-context-files").CombinedOutput()
		if err != nil {
			return analyzedMsg{ref: p.ref, sha: sha, err: fmt.Errorf("%s", firstLine(string(out)))}
		}

		verdict, reason := parseVerdict(string(out))
		if verdict == "" {
			return analyzedMsg{ref: p.ref, sha: sha, verdict: "unclear", reason: "couldn't parse a verdict from the analysis"}
		}
		return analyzedMsg{ref: p.ref, sha: sha, verdict: verdict, reason: reason}
	}
}

func parseVerdict(text string) (verdict, reason string) {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(strings.ToUpper(line), "VERDICT:"):
			verdict = strings.ToLower(strings.TrimSpace(line[len("VERDICT:"):]))
		case strings.HasPrefix(strings.ToUpper(line), "REASON:"):
			reason = strings.TrimSpace(line[len("REASON:"):])
		}
	}
	switch verdict {
	case "pr-caused", "unrelated", "unclear":
		return verdict, reason
	default:
		return "", ""
	}
}
