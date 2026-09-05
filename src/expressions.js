// Configuration-expression syntax used by the single GitLab CI grammar.
module.exports = {
  interpolation: $ => seq(
    '$[[',
    field('value', $.access),
    repeat(seq('|', $.function_call)),
    ']]',
  ),
  access: $ => seq(
    field('context', $.identifier),
    repeat1(choice(
      seq('.', field('property', $.identifier)),
      $.index,
    )),
  ),
  index: $ => seq('[', $.integer, ']'),
  function_call: $ => seq(
    field('name', $.identifier),
    optional(field('arguments', $.argument_list)),
  ),
  argument_list: $ => seq('(', optional(seq(
    $._argument, repeat(seq(',', $._argument)),
  )), ')'),
  _argument: $ => choice($.integer, $.string, $.yaml_string),
  identifier: _ => /[A-Za-z_][A-Za-z0-9_-]*/,
  integer: _ => /[0-9]+/,
  string: $ => choice(
    seq('"', repeat(choice(alias($._double_fragment, $.string_content), $.escape_sequence)), '"'),
    seq("'", repeat(choice(alias($._single_fragment, $.string_content), $.escape_sequence)), "'"),
  ),
  _double_fragment: _ => token.immediate(prec(-1, /[^"\\\r\n]+/)),
  _single_fragment: _ => token.immediate(prec(-1, /[^'\\\r\n]+/)),
  escape_sequence: _ => token.immediate(/\\[^\r\n]/),
  // Editor injections retain YAML escaping. Decoded expressions use string.
  yaml_string: _ => token(choice(
    /\\"(?:[^"\\\r\n]|\\[^"\r\n])*\\"/,
    /''[^'\r\n]*''/,
  )),
};
