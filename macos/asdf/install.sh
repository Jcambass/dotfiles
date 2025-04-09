if ! [ -d $HOME/.asdf ]; then
  echo "› installing ASDF core"
  git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.10.2 -q
fi

echo "› installing ASDF plugins"
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add ruby https://github.com/asdf-vm/asdf-ruby.git
asdf plugin add golang https://github.com/kennyp/asdf-golang.git
