# Third-Party Sources

`vendor/tree-sitter-yaml` contains the grammar, scanner, schemas, and supporting
headers from [tree-sitter-grammars/tree-sitter-yaml](https://github.com/tree-sitter-grammars/tree-sitter-yaml).

Tree-sitter CLI generates the C parsers and supporting headers. Its MIT license
is retained in `vendor/licenses/tree-sitter.txt`.

`data/keyword-schema.json` retains structural keys and references from GitLab's
`app/assets/javascripts/editor/schema/ci.json`, with descriptions, examples, and
value constraints removed. The source revision and SHA-256 hashes are recorded
in `gitlab-ci-reference.lock.json`. GitLab's license is retained in
`vendor/licenses/gitlab.txt`.

`data/documented-keywords.json` is an inventory of keyword identifiers and source
headings from the pinned GitLab documentation. GitLab licenses its documentation
under CC BY-SA 4.0, as stated in the retained GitLab license. The inventory stores
keyword names for coverage checks and does not reproduce the reference prose.
