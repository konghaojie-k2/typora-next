Feature: Toolbar tooltip quick reveal

  As a user of Typora Next
  I want tooltips to appear quickly when I hover toolbar buttons
  So that I can understand each icon's function without waiting

  Scenario: Hovering a toolbar button reveals a custom tooltip within 150ms
    Given the toolbar contains buttons with data-tooltips
    When the user hovers over the open file button
    Then a tooltip should appear within 150 milliseconds
    And the tooltip text should be "Open File (Ctrl+O)"

  Scenario: Moving the mouse away hides the tooltip immediately
    Given a tooltip is currently visible
    When the user moves the mouse away from the button
    Then the tooltip should be hidden immediately

  Scenario: Native browser title tooltips are disabled for toolbar buttons
    Given the toolbar contains buttons with data-tooltips
    Then no toolbar button should have a native title attribute
