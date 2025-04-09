# Only set GOPATH on Mac
if test "$(uname)" = "Darwin"
then
  export GOPATH=$PROJECTS/go
  export PATH="$GOPATH/bin:$PATH"
fi
