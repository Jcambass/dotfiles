if ! [ -d "$HOME/.asdf" ]; then
  echo "› installing ASDF core"
  git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.10.2 -q
fi

if command -v asdf >/dev/null 2>&1; then
  ASDF_BIN="$(command -v asdf)"
elif [ -x "$HOME/.asdf/bin/asdf" ]; then
  ASDF_BIN="$HOME/.asdf/bin/asdf"
else
  echo "› asdf is unavailable, skipping ASDF plugins"
  return 0 2>/dev/null || exit 0
fi

asdf_plugin_add() {
  plugin_name="$1"
  plugin_url="$2"

  if "$ASDF_BIN" plugin list 2>/dev/null | grep -qx "$plugin_name"; then
    return 0
  fi

  "$ASDF_BIN" plugin add "$plugin_name" "$plugin_url"
}

echo "› installing ASDF plugins"
asdf_plugin_add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf_plugin_add ruby https://github.com/asdf-vm/asdf-ruby.git
asdf_plugin_add golang https://github.com/kennyp/asdf-golang.git

unset ASDF_BIN
unset -f asdf_plugin_add

return 0 2>/dev/null || exit 0
