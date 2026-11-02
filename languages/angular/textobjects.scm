(comment)+ @comment.around

; An element counts as a section, and a control flow block as a smaller one.
(element
  (start_tag)
  (_)* @class.inside
  (end_tag)) @class.around

(statement_block
  "{"
  (_)* @function.inside
  "}") @function.around
