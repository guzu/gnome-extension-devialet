#!/bin/bash

cd "$(dirname "$0")"

eslint() {
	npx eslint *.js
}

shexli_pip() {
	virtualenv venv
	. venv/bin/activate
	pip install -U shexli
	shexli path_to_zip_or_folder
}

shexli() {
	#uv venv
	#uv pip install shexli
	uv run shexli dvlt-ctrl@guzu.github.io.shell-extension.zip
}

eslint
shexli
