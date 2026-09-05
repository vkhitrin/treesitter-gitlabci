const PREC = { OR: 1, AND: 2, COMPARE: 3, NOT: 4 };

module.exports = {
    _expression: $ => choice(
      $.variable, $.string, $.yaml_string, $.regex, $.null, $.boolean, $.integer,
      $.interpolation, $.parenthesized_expression,
      $.unary_expression, $.binary_expression,
    ),
    variable: _ => /\$[A-Za-z_][A-Za-z0-9_]*/,
    null: _ => 'null',
    boolean: _ => choice('true', 'false'),
    parenthesized_expression: $ => seq('(', $._expression, ')'),
    unary_expression: $ => prec.right(PREC.NOT, seq(
      field('operator', '!'), field('operand', $._expression),
    )),
    binary_expression: $ => choice(...[
      ['||', PREC.OR], ['&&', PREC.AND],
      ['==', PREC.COMPARE], ['!=', PREC.COMPARE],
      ['=~', PREC.COMPARE], ['!~', PREC.COMPARE],
    ].map(([operator, precedence]) => prec.left(precedence, seq(
      field('left', $._expression), field('operator', operator),
      field('right', $._expression),
    )))),
    regex: $ => seq('/', repeat(choice(
      $.regex_content, $.regex_escape, $.character_class,
    )), '/', optional($.regex_flags)),
    regex_content: _ => token.immediate(/[^/\\\[\r\n]+/),
    regex_escape: _ => token.immediate(/\\[^\r\n]/),
    character_class: _ => token.immediate(/\[(?:[^\]\\\r\n]|\\[^\r\n])*\]/),
    regex_flags: _ => token.immediate('i'),
};
