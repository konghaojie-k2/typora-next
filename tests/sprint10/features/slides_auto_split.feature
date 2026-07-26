Feature: Slides v3 — structure split and measured packing

  As a user with a regular markdown document
  I want slides to be paginated by real rendered height
  So that every page is full but never overflows

  Scenario: Regular document splits into chapters by H1
    Given a markdown document without explicit slide separators
    When the document is parsed into slide structure
    Then each H1 becomes a chapter with a cover
    And chapter content keeps its H2 headings inline

  Scenario: Document with explicit separators keeps hard boundaries
    Given a markdown document with explicit --- separators
    When the document is parsed into slide structure
    Then groups split exactly at the --- markers

  Scenario: Setext heading is not mistaken for a separator
    Given a markdown document containing a setext heading
    When the document is parsed into slide structure
    Then the setext line does not create a group boundary

  Scenario: Pages pack by measured height without overflow
    Given a series of measured elements exceeding one page
    When they are packed by available height
    Then every page is within the height budget
    And all elements are preserved in order

  Scenario: Subsection heading stays with its content
    Given measured elements where a heading would land at a page bottom
    When they are packed by available height
    Then no page ends with a lone heading

  Scenario: Splitting mid-section marks continuation page
    Given a long H2 section that must split across pages
    When they are packed by available height
    Then the continuation page is marked with the H2 text
