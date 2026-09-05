// One language handles YAML documents and their same-language scalar injections.
const yaml = require('./vendor/tree-sitter-yaml/grammar');
require('./src/root-context')(yaml.grammar);
const expressions = require('./src/expressions');
const conditions = require('./src/conditions');

module.exports = grammar(yaml, {
  name: 'gitlab_ci',
  externals: ($, original) => [...original,
    $._yaml_document, $._template_document, $._condition_document, $._conditions_document, $._expression_space,
  ],
  extras: ($, original) => [...original, $._expression_space],
  rules: {
    stream: ($, original) => choice(
      seq($._yaml_document, original),
      seq($._template_document, $.template),
      seq($._condition_document, $._if_key, ':', optional($._condition_gap), $.condition),
      seq($._conditions_document, $._variables_key, ':', optional($._condition_gap), $.conditions),
    ),
    _if_key: _ => choice('if', "'if'", '"if"'),
    _variables_key: _ => choice('variables', "'variables'", '"variables"'),
    _condition_gap: $ => repeat1(alias($._condition_comment, $.comment)),
    _condition_comment: _ => token(/#[^\r\n]*/),
    conditions: $ => seq(optional(seq(alias($._condition_anchor, $.anchor), optional($._condition_gap))), choice(
      seq('[', optional($._condition_gap), optional(seq($._condition_item,
        repeat(seq(',', optional($._condition_gap), $._condition_item)), optional(seq(',', optional($._condition_gap))))), ']'),
      repeat1(seq('-', optional($._condition_gap), $._condition_item)),
    )),
    _condition_item: $ => seq(choice($.condition, $.condition_reference), optional($._condition_gap)),
    _condition_anchor: _ => token(/&[^\s\[\]{},]+/),
    condition_reference: _ => token(choice(/\*[^\s\[\]{},]+/, /!reference\s*\[[^\]]*\]/)),
    template: $ => repeat1(choice($.interpolation, alias($._template_variable, $.variable), $.text)),
    _template_variable: _ => token(choice(/\$[A-Za-z_][A-Za-z0-9_]*/, /\$\{[A-Za-z_][A-Za-z0-9_]*\}/)),
    condition: $ => seq(optional(alias($._condition_anchor, $.anchor)), choice(
      $._expression,
      prec.dynamic(1, seq("'", $._expression, "'")),
      prec.dynamic(1, seq('"', $._expression, '"')),
      seq($.block_scalar_header, $._expression),
    )),
    block_scalar_header: _ => token(seq(/[|>][1-9+-]*/, /[^\n]*/, '\n')),
    ...expressions,
    ...conditions,
    text: _ => token(prec(-1, choice(/[^$\\]+/, /\\\\/, '\\',
      /\\\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/,
      /\$\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/, '$', '$['))),
  },
});
