Feature: Dynamic inline SVG diagrams (L1 hover + L2 step-through)

  As a learner reading mechanism diagrams
  I want to hover and step through the labeled parts of an SVG
  So that a static picture can explain a process in order

  Scenario: Parts are ordered by data-order
    Given an SVG with three parts whose data-order is 3 1 2
    When the parts are collected
    Then the collected order should be part one part two part three
    And the labels should come from data-label

  Scenario: Missing label falls back to the part id
    Given an SVG with a part without data-label
    When the parts are collected
    Then the label should be the part id

  Scenario: Step states mark past current and future
    When the step state for index 0 is queried at current 1
    Then the state should be past
    When the step state for index 1 is queried at current 1
    Then the state should be current
    When the step state for index 2 is queried at current 1
    Then the state should be future

  Scenario: Reduced motion disables autoplay
    Then autoplay should be allowed when reduced motion is off
    And autoplay should be disabled when reduced motion is on

  Scenario: Progress text advances with steps
    Then progress before stepping of 5 should read 0 / 5
    And progress at current 2 of 5 should read 3 / 5

  Scenario: Dynamic SVG runtime is wired into the render pipeline
    Given the main script source for svg dynamic
    Then main.js should initialize the dynamic SVG runtime

  Scenario: Dynamic SVG module loads before the main script
    Given the index html source for svg dynamic
    Then svg-dynamic.js should load before main.js

  Scenario: Diagram spec documents the data-part convention
    Given the inline svg spec
    Then the spec should require data-part groups
    And the spec should require data-label and data-order

  Scenario: Dynamic panel styles respect reduced motion
    Given the stylesheet source
    Then the stylesheet should style the dynamic panel
    And the stylesheet should disable transitions under reduced motion
