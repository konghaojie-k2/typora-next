Feature: Block-level AI companion for diagrams and tables

  As a learner reading a course chapter
  I want to launch AI companion on an SVG, table or Mermaid block
  So that I can ask about the densest information on the page without selecting text

  Scenario: Table source is recovered by ordinal
    Given a chapter markdown with two tables and a fenced code block in between
    When the table sources are extracted
    Then exactly 2 table sources should be found
    And the second table source should contain its own header

  Scenario: Blockquote table keeps its content
    Given a chapter markdown with a table inside a blockquote
    When the table sources are extracted
    Then the table source should contain the blockquote table cells

  Scenario: Mermaid source is recovered by ordinal
    Given a chapter markdown with two mermaid fences
    When the mermaid sources are extracted
    Then exactly 2 mermaid sources should be found
    And the second mermaid source should start with its diagram type

  Scenario: Missing ordinal falls back to no source
    Given a chapter markdown with one table
    When the source for table index 3 is requested
    Then no block source should be returned

  Scenario: Block identity is stable and readable
    Given a chapter file named "chapters/04-wave.md"
    When the block label and key are built for the second mermaid block
    Then the label should read Mermaid 图 #2
    And the key should read block::04-wave::mermaid::2

  Scenario: Long block source is truncated but keeps both ends
    Given a block source with 4000 characters
    When the source is truncated to 1500 characters
    Then the truncated source should contain the truncation marker
    And the truncated source should start and end with the original content

  Scenario: Block companion is wired into the render pipeline
    Given the main script source
    Then main.js should initialize the block companion with the chapter markdown

  Scenario: Block companion module loads before the learning integration
    Given the index html source
    Then block-companion.js should load before mode-integration.js

  Scenario: Companion modal accepts block identity overrides
    Given the companion modal source
    Then the modal should honor a start key override
    And the modal should allow skipping cue marks

  Scenario: Learning integration exposes the block entry point
    Given the learning integration source
    Then the integration should export openAICompanionForBlock
    And the block entry should pass the block source through context
