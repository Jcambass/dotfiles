completion="${ASDF_DIR:-$HOME/.asdf}/completions"
if test -f "$completion"
then
  source "$completion"
fi