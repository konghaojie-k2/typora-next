# Image Test Document

This document tests image rendering capabilities.

---

## 1. Local Images

### Relative Path Image

![Local Image](./sample-image.png)

This should display a local image from a relative path.

### Non-existent Local Image

![Missing Image](./nonexistent.png)

This should show a placeholder for missing image.

---

## 2. Network Images

### Valid URL Image

![Placeholder Image](https://via.placeholder.com/300x200 "A placeholder image")

This network image should load correctly.

### External URL Image

![GitHub Logo](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png "GitHub Logo")

Another network image test.

### Invalid URL Image

![Broken URL](https://nonexistent-domain.invalid/fake-image.png "This URL does not exist")

This should show an error placeholder.

---

## 3. Empty and Special Cases

### Empty Source

![No Source]()

This should show a placeholder for empty src.

### No Alt Text

![](https://via.placeholder.com/100)

Image without alt text.

---

## 4. Image with Different Formats

### PNG

![PNG Image](https://via.placeholder.com/150/png)

### JPG

![JPG Image](https://via.placeholder.com/150/jpg)

### GIF

![GIF Image](https://via.placeholder.com/150/gif)

---

## 5. Image in Different Contexts

### Image in Link

[![Clickable Image](https://via.placeholder.com/100)](https://example.com)

### Image in Blockquote

> ![Quote Image](https://via.placeholder.com/80)
>
> This image is inside a blockquote.

### Image in Table

| Image | Description |
|-------|-------------|
| ![Table Image](https://via.placeholder.com/50) | Small image in table |
| ![Another](https://via.placeholder.com/60) | Another table image |

---

## 6. Size Variations

### Small Image

![Small](https://via.placeholder.com/32x32)

### Medium Image

![Medium](https://via.placeholder.com/200x100)

### Large Image

![Large](https://via.placeholder.com/600x400)

---

**Instructions for Testing:**

1. Click on any image to open lightbox
2. Use +/- buttons or keyboard to zoom
3. Press ESC or click outside to close
4. Scroll wheel can zoom when lightbox is open (browser default)
5. Check placeholder appearance for broken images