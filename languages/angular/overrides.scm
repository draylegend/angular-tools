(comment) @comment

; Plain attribute values and string literals. Binding values are Angular
; expressions, so brackets and quotes still close inside them.
[
  (quoted_attribute_value)
  (string)
] @string

; `/` closes a tag only inside an unfinished opening tag, so everything else is
; markup: text, expressions, closing tags and completed opening tags.
[
  (document)
  (ERROR)
] @markup.inclusive

[
  (start_tag)
  (self_closing_tag)
] @tag

; The end of a completed opening tag is markup again.
((start_tag ">" @markup.inclusive)
  (#eq? @markup.inclusive ">"))

; A missing `>` or `/>` marks where an unfinished opening tag ends.
((start_tag ">" @tag.inclusive)
  (#eq? @tag.inclusive ""))
((self_closing_tag "/>" @tag.inclusive)
  (#eq? @tag.inclusive ""))

[
  (property_binding)
  (event_binding)
  (two_way_binding)
  (animation_binding)
  (structural_directive)
] @markup

; An element that holds only an unfinished opening tag also covers the
; whitespace after it.
((element . (start_tag ">" @_missing) .) @tag
  (#eq? @_missing ""))

; Error recovery can drop the tag node of an unfinished opening tag; its name
; and attributes are still there.
(ERROR "<" . (tag_name) @tag.inclusive)
(ERROR "<" . (tag_name) (attribute) @tag.inclusive)
