# Detect which VS Code command is available
if command -v code-insiders &> /dev/null; then
  CODE_CMD="code-insiders"
elif command -v code &> /dev/null; then
  CODE_CMD="code"
else
  echo "› neither code nor code-insiders found, skipping VSCode extensions"
  exit 0
fi

echo "› installing VSCode extensions using $CODE_CMD"
$CODE_CMD --install-extension eamodio.gitlens
$CODE_CMD --install-extension timonwong.shellcheck
$CODE_CMD --install-extension nilpatel.title
$CODE_CMD --install-extension github.vscode-pull-request-github
$CODE_CMD --install-extension sleistner.vscode-fileutils
