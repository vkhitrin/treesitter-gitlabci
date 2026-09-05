# tree-sitter-gitlab-ci

> [!WARNING]
> This is experimental grammar.

> [!NOTE]
> The YAML parser extends a pinned copy of `tree-sitter-yaml` and retains its
> syntax tree.

Tree-sitter syntax for GitLab CI YAML.
The grammar follows GitLab's [canonical YAML reference](https://gitlab.com/gitlab-org/gitlab/-/tree/master/doc/ci/yaml?ref_type=heads).

The GitLab reference commit is pinned in `package.json` under
`gitlabCiReference.revision`. Keyword queries and predefined-variable highlighting
use that revision. Other variable names remain valid and receive ordinary variable
highlighting in conditions.

## Development

This project uses [mise](https://mise.jdx.dev/) for managing the complete lifecycle.

```sh
mise trust
mise install
mise run
```

The project sets `PYTHON`, `CC`, and `CXX` so native builds use the managed
Python and Clang. Clang's `--driver-mode=g++` selects the C++ compiler driver.

`make` is required across macOS and Linux.

### Tasks

| Task                                       | Purpose                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `mise run`                                 | Install dependencies, generate C, build binding, and run tests                   |
| `mise run generate`                        | Regenerate the parser                                                            |
| `mise run build`                           | Generate parsers and compile Node binding                                        |
| `mise run test`                            | Run all local corpus, query, injection, and integration tests                    |
| `mise run parse -- path/to/.gitlab-ci.yml` | Print a YAML syntax tree                                                         |
| `mise run reference:sync`                  | Refresh the pinned upstream reference and generated queries                      |
| `mise run reference:sync -- master`        | Update the reference to GitLab's current master commit                           |
| `mise run reference:diff`                  | Log the pinned revision and show documentation changes against upstream master   |
| `mise run reference:diff -- <ref>`         | Compare the pinned documentation with a specific upstream branch, tag, or commit |

## Using the parser

The parser targets Tree-sitter ABI 15.

To build the parser library locally:

```sh
mise run generate
mkdir -p build/parsers
mise exec -- vp exec tree-sitter build . --output build/parsers/gitlab_ci.so
```
