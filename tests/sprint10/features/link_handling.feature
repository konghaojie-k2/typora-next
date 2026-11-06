Feature: Local file link handling — bare URL linkify + click routing

  As a user pasting bare file:// URLs into markdown
  I want them clickable in both main view and slides
  So that local html pages open in the system browser

  Scenario: Bare file:// URL in text becomes a clickable link
    Given text containing a bare file URL with percent-encoded path
    When the URL matcher scans the text
    Then the full URL including encoded segments is matched

  Scenario: Trailing CJK punctuation does not join the URL
    Given text where a bare URL is followed by a CJK full stop
    When the URL matcher scans the text
    Then the matched URL excludes the trailing punctuation

  Scenario: Balanced parentheses stay inside the URL
    Given a bare URL containing balanced parentheses
    When the URL matcher scans the text
    Then the matched URL keeps the parentheses

  Scenario: Main view renders bare URLs as anchors before click routing
    Given the main.js rendering pipeline source
    When checking the main view linkify wiring
    Then text nodes are linkified before click delegation is initialized

  Scenario: Slides linkify bare URLs and route clicks to system opener
    Given the slides.js rendering pipeline source
    When checking the slides link wiring
    Then bare URLs inside measured content are linkified before packing
    And anchor clicks are routed to open_external or open_local_file
