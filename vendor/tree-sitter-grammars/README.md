# Vendored tree-sitter grammars

WASM binaries used by `src/lang/tree-sitter-loader.js`. Vendored (rather
than pulled as runtime deps) so the npm package and the SEA binary ship
exactly the grammars we support — adding all of `@vscode/tree-sitter-wasm`
would balloon the install by ~22 MB for languages we never chunk.

Source: extracted from `@vscode/tree-sitter-wasm@0.3.1`. That package
re-builds upstream `tree-sitter-*` grammars against the tree-sitter
0.25.x ABI, which matches the runtime `web-tree-sitter@0.26.x` we depend
on. Older prebuilds (e.g. `tree-sitter-wasms@0.1.13`) target an older ABI
and fail to load.

Re-extract with:

    npm pack @vscode/tree-sitter-wasm
    tar -xzf vscode-tree-sitter-wasm-*.tgz
    cp package/wasm/tree-sitter-python.wasm vendor/tree-sitter-grammars/python.wasm
    cp package/wasm/tree-sitter-rust.wasm   vendor/tree-sitter-grammars/rust.wasm
