; HTML structure and literal values.
(comment) @comment
(doctype) @tag.doctype
(tag_name) @tag
(attribute_name) @attribute
(attribute_value) @string
(quoted_attribute_value) @string
(entity) @string.escape
(string) @string
(template_chars) @string
(regular_expression) @string.regex
(number) @number
(identifier) @variable

; Angular blocks, bindings and expressions.
[
  (control_keyword)
  (special_keyword)
  (prefetch_keyword)
  (icu_clause)
] @keyword
"@" @keyword
(binding_name) @attribute
(class_name) @attribute
(structural_directive (identifier) @attribute)
(member_expression property: (identifier) @property)
(pair key: (identifier) @property)
(call_expression function: (identifier) @function)
(pipe_call name: (identifier) @function)

((identifier) @boolean
  (#match? @boolean "^(true|false)$"))
((identifier) @constant.builtin
  (#match? @constant.builtin "^(null|undefined)$"))
((identifier) @variable.special
  (#match? @variable.special "^(this|\\$(event|index|count|first|last|even|odd))$"))

[
  (coalescing_operator)
  (conditional_operator)
  (pipe_operator)
  (ternary_operator)
  (unary_operator)
] @operator
(binary_expression operator: _ @operator)
["=" "=>" "..." "." "?." "!."] @operator
["," ";" ":"] @punctuation.delimiter
["<" ">" "</" "/>" "(" ")" "[" "]" "[(" ")]" "[@" "{" "}" "{{" "}}" "${"] @punctuation.bracket
