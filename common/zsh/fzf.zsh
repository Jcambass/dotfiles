# Set up fzf key bindings (Ctrl+R for history, Ctrl+T for files, Alt+C for cd)
if [[ -f /opt/homebrew/opt/fzf/shell/key-bindings.zsh ]]; then
  source /opt/homebrew/opt/fzf/shell/key-bindings.zsh
elif [[ -f /usr/share/doc/fzf/examples/key-bindings.zsh ]]; then
  source /usr/share/doc/fzf/examples/key-bindings.zsh
elif [[ -f ~/.fzf.zsh ]]; then
  source ~/.fzf.zsh
fi

# fzf default options: use a top-down list layout for history search
export FZF_DEFAULT_OPTS="--height 40% --layout=reverse --border"
export FZF_CTRL_R_OPTS="--scheme=history"
