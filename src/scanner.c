// Keep upstream YAML scanning unchanged. Entry tokens let the same generated
// language parse scalar injections as well as full documents.
#include "../vendor/tree-sitter-yaml/src/scanner.c"
#include <string.h>

enum { YAML_DOCUMENT = ERR_REC + 1, TEMPLATE_DOCUMENT, CONDITION_DOCUMENT, CONDITIONS_DOCUMENT, EXPRESSION_SPACE };
enum { UNSET, YAML_MODE, TEMPLATE_MODE, CONDITION_MODE, CONDITIONS_MODE };

typedef struct {
    Scanner *yaml;
    uint8_t mode;
} GitlabScanner;

static uint8_t key_mode(char *key) {
    size_t length = strlen(key);
    while (length && is_wsp(key[length - 1])) key[--length] = '\0';
    if (strcmp(key, "if") == 0 || strcmp(key, "'if'") == 0 || strcmp(key, "\"if\"") == 0) return CONDITION_MODE;
    if (strcmp(key, "variables") == 0 || strcmp(key, "'variables'") == 0 ||
        strcmp(key, "\"variables\"") == 0) return CONDITIONS_MODE;
    return YAML_MODE;
}

static bool entry(GitlabScanner *scanner, TSLexer *lexer) {
    // Look ahead without consuming input. Full YAML mappings use the upstream
    // scanner; isolated if pairs and variables lists use the expression rules.
    lexer->mark_end(lexer);
    char key[16] = {0};
    unsigned count = 0;
    uint8_t candidate = UNSET;
    bool interpolation = false, variable = false, block = false, escaped = false, regex = false;
    int32_t quote = 0, previous = 0, before_previous = 0;
    unsigned brackets = 0;
    bool first = true;
    while (!lexer->eof(lexer)) {
        int32_t c = lexer->lookahead;
        if (!quote && !brackets && !block && !regex && c == '#' && (first || is_wht(previous))) {
            while (!lexer->eof(lexer) && !is_nwl(lexer->lookahead)) lexer->advance(lexer, false);
            continue;
        }
        lexer->advance(lexer, false);
        if (c == '$' && (lexer->lookahead == '{' || lexer->lookahead == '_' ||
                         (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
                         (lexer->lookahead >= 'a' && lexer->lookahead <= 'z'))) variable = true;
        if (first && is_wht(c)) continue;
        if (first) {
            first = false;
            block = c == '|' || c == '>';
            if (c == '{' || c == '[' || c == '%' || (c == '-' && is_wht(lexer->lookahead))) {
                candidate = YAML_MODE;
                break;
            }
        }
        if (c == '[' && previous == '[' && before_previous == '$') {
            interpolation = true;
            brackets = 2;
        } else if (brackets) {
            if (c == '[') brackets++;
            if (c == ']') brackets--;
        } else if (quote || regex) {
            if (escaped) escaped = false;
            else if ((quote == '"' || regex) && c == '\\') escaped = true;
            else if (c == quote) quote = 0;
            else if (regex && c == '/') regex = false;
        } else if (c == '\'' || c == '"') quote = c;
        else if (candidate == CONDITION_MODE && c == '/') regex = true;
        else if (!block && c == ':' && (key[0] == '"' || key[0] == '\'' || is_wht(lexer->lookahead) || lexer->lookahead == ',' ||
                                       lexer->lookahead == ']' || lexer->lookahead == '}')) {
            if (candidate != UNSET) {
                candidate = YAML_MODE;
                break;
            }
            candidate = key_mode(key);
            if (candidate == YAML_MODE) break;
            for (;;) {
                while (is_wht(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
                if (lexer->lookahead != '#') break;
                while (!is_nwl(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
            }
            int32_t start = lexer->lookahead;
            if (candidate == CONDITIONS_MODE) {
                if (start != '[' && start != '-' && start != '&') candidate = YAML_MODE;
            } else if (start == '{' || start == '[' || start == '*') candidate = YAML_MODE;
            else if (start == '!') {
                const char *reference = "!reference";
                while (*reference && lexer->lookahead == *reference) {
                    lexer->advance(lexer, false);
                    reference++;
                }
                if (!*reference && is_wht(lexer->lookahead)) candidate = YAML_MODE;
            }
            block = start == '|' || start == '>';
            if (candidate == YAML_MODE) break;
        }
        if (candidate == UNSET && count < sizeof(key) - 1) key[count++] = c < 128 ? (char)c : '?';
        before_previous = previous;
        previous = c;
    }
    if (candidate == UNSET) candidate = interpolation || variable ? TEMPLATE_MODE : YAML_MODE;
    scanner->mode = candidate;
    lexer->result_symbol = candidate == TEMPLATE_MODE ? TEMPLATE_DOCUMENT :
                           candidate == CONDITION_MODE ? CONDITION_DOCUMENT :
                           candidate == CONDITIONS_MODE ? CONDITIONS_DOCUMENT : YAML_DOCUMENT;
    return true;
}

void *tree_sitter_gitlab_ci_external_scanner_create(void) {
    GitlabScanner *scanner = ts_calloc(1, sizeof(GitlabScanner));
    scanner->yaml = tree_sitter_yaml_external_scanner_create();
    return scanner;
}

void tree_sitter_gitlab_ci_external_scanner_destroy(void *payload) {
    GitlabScanner *scanner = payload;
    tree_sitter_yaml_external_scanner_destroy(scanner->yaml);
    ts_free(scanner);
}

unsigned tree_sitter_gitlab_ci_external_scanner_serialize(void *payload, char *buffer) {
    GitlabScanner *scanner = payload;
    // Upstream writes indentation entries in pairs of int16_t. Leave room for
    // its final pair before checking that the snapshot and mode fit the host.
    int16_t snapshot[TREE_SITTER_SERIALIZATION_BUFFER_SIZE / sizeof(int16_t) + 2];
    unsigned length = serialize(scanner->yaml, (char *)snapshot);
    if (length >= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return 0;
    memcpy(buffer, snapshot, length);
    buffer[length] = (char)scanner->mode;
    return length + 1;
}

void tree_sitter_gitlab_ci_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    GitlabScanner *scanner = payload;
    scanner->mode = length ? (uint8_t)buffer[length - 1] : UNSET;
    deserialize(scanner->yaml, buffer, length ? length - 1 : 0);
}

bool tree_sitter_gitlab_ci_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    GitlabScanner *scanner = payload;
    if (!scanner->mode && valid_symbols[YAML_DOCUMENT] && !valid_symbols[ERR_REC]) return entry(scanner, lexer);
    if (scanner->mode == YAML_MODE) return scan(scanner->yaml, lexer, valid_symbols);
    if (valid_symbols[EXPRESSION_SPACE] && is_wht(lexer->lookahead) && !lexer->eof(lexer)) {
        do lexer->advance(lexer, true); while (is_wht(lexer->lookahead) && !lexer->eof(lexer));
        lexer->mark_end(lexer);
        lexer->result_symbol = EXPRESSION_SPACE;
        return true;
    }
    return false;
}
