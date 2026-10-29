package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func failingPR() *pr {
	checks := []checkRun{{
		Name:       "build",
		Status:     "COMPLETED",
		Conclusion: "FAILURE",
		DetailsURL: "https://github.com/owner/repo/actions/runs/123",
	}}
	return &pr{
		ref:  "owner/repo#42",
		repo: "owner/repo",
		data: &ghPR{
			Number: 42,
			Title:  "Example change",
			State:  "OPEN",
			Checks: checks,
		},
		ci:     rollupStatus(checks),
		checks: buildCheckDetails(checks, map[string]bool{"build": true}),
	}
}

func TestRemovedAnalysisShortcutDoesNothing(t *testing.T) {
	m := newModel([]string{"owner/repo#42"}, false, defaultInterval)
	m.prs = []*pr{failingPR()}

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
	if cmd != nil {
		t.Fatal("removed analysis shortcut must not launch a command")
	}
	if updated.(model).status != "" {
		t.Fatal("removed analysis shortcut must not change status")
	}
}

func TestFooterKeepsOnlySupportedActions(t *testing.T) {
	_, zones := buttonRow()
	want := []string{"add", "remove", "retry", "open", "quit"}
	if len(zones) != len(want) {
		t.Fatalf("got %d actions, want %d", len(zones), len(want))
	}
	for i, action := range want {
		if zones[i].action != action {
			t.Errorf("action %d = %q, want %q", i, zones[i].action, action)
		}
	}
}

func TestFailureDetailsKeepCheckStatusWithoutAgentPrompt(t *testing.T) {
	p := failingPR()
	detail := strings.Join(renderDetail(p, 100), "\n")
	for _, text := range []string{"build", "required", "retry-ready", "1 failing"} {
		if !strings.Contains(detail, text) {
			t.Errorf("failure details missing %q", text)
		}
	}
	if strings.Contains(detail, "AI:") {
		t.Fatal("failure details must not advertise agent analysis")
	}
	label, _ := tableCI(p.checks)
	if label != "req" {
		t.Errorf("CI label = %q, want req", label)
	}
}

func TestRetryStillCreatesCommand(t *testing.T) {
	m := newModel([]string{"owner/repo#42"}, false, defaultInterval)
	p := failingPR()
	m.prs = []*pr{p}
	if cmd := m.applyAction("retry"); cmd == nil {
		t.Fatal("retry must still create a command for a completed failed run")
	}
	if !p.retrying {
		t.Fatal("retry must mark the selected PR as retrying")
	}
}

func TestRefreshDoesNotResurrectRemovedPR(t *testing.T) {
	m := newModel(nil, false, defaultInterval)
	updated, _ := m.Update(fetchedMsg{prs: []*pr{failingPR()}})
	if len(updated.(model).prs) != 0 {
		t.Fatal("stale fetch must not restore a removed PR")
	}
}
