# Only use Brew on Mac
if test "$(uname)" = "Darwin"
then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
