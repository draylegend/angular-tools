(comment) @annotation

(element
  (start_tag (tag_name) @name)) @item

(self_closing_tag (tag_name) @name) @item
(script_element (start_tag (tag_name) @name)) @item
(style_element (start_tag (tag_name) @name)) @item

(if_statement
  "@" @context
  (control_keyword) @name
  condition: (if_condition) @context) @item

(for_statement
  "@" @context
  (control_keyword) @name
  declaration: (for_declaration) @context) @item

(switch_statement
  "@" @context
  (control_keyword) @name
  value: (expression) @context) @item

(defer_statement "@" @context (control_keyword) @name) @item

(let_statement
  "@" @context
  (control_keyword) @context
  (assignment_expression name: (identifier) @name)) @item
