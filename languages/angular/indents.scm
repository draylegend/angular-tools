; End captures keep closing tags and block braces aligned with their opener.
(element
  (start_tag) @start
  (end_tag)? @end) @indent

(script_element
  (start_tag) @start
  (end_tag) @end) @indent

(style_element
  (start_tag) @start
  (end_tag) @end) @indent

(start_tag ">" @end) @indent
(self_closing_tag "/>" @end) @indent
(statement_block "{" @start "}" @end) @indent
(switch_body "{" @start "}" @end) @indent
(object "{" @start "}" @end) @indent
(array "[" @start "]" @end) @indent
