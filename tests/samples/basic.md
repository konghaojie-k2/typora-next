# CommonMark Basic Syntax Test

## Headings

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

## Paragraphs and Text Formatting

This is a normal paragraph with **bold text** and *italic text*.

This paragraph has ***bold and italic combined*** text.

You can also use _underscores_ for **bold** and *italic*.

Here is some `inline code` within a paragraph.

## Lists

### Unordered List

- Item one
- Item two
- Item three
  - Nested item A
  - Nested item B
    - Deep nested item
- Item four

### Ordered List

1. First item
2. Second item
3. Third item
   1. Nested item 3.1
   2. Nested item 3.2
4. Fourth item

### Mixed List

1. Ordered item
   - Unordered nested item
   - Another nested item
2. Another ordered item
   1. Nested ordered
   - Nested unordered

## Links

This is an [inline link](https://www.example.com).

This is a [link with title](https://www.example.com "Example Website").

This is a [relative link](../other-file.md).

This is an [anchor link](#headings).

## Images

![Alt text for image](https://via.placeholder.com/150 "Image title")

![Local image](./images/sample.png)

## Blockquotes

> This is a simple blockquote.
>
> It can have multiple paragraphs.

> Blockquotes can be nested.
>
> > This is a nested blockquote.
> >
> > > And even deeper nesting.

> Blockquotes can contain other elements:
>
> - List item one
> - List item two
>
> And even **formatted text**.

## Horizontal Rules

Above the horizontal rule.

---

Below the horizontal rule.

***

Also works with asterisks.

___

And underscores.

## Inline Elements Combined

This paragraph demonstrates **bold**, *italic*, `code`, [link](https://example.com), and ~~strikethrough~~ all together.

You can escape special characters: \*not italic\*, \**not bold\**, \`not code\`.