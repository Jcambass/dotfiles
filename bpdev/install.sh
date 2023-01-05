
if [ -z $(hostname | grep bpdev) ]; then
  exit 0
fi

echo "› installing VSCode extensions"
code --install-extension eamodio.gitlens
code --install-extension timonwong.shellcheck
code --install-extension nilpatel.title
code --install-extension github.vscode-pull-request-github
code --install-extension sleistner.vscode-fileutils
