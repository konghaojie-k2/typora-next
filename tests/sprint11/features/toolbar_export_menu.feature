Feature: Toolbar export menu consolidation

  As a user of Typora Next
  I want export Word / export PDF / share merged into one dropdown menu
  So that the toolbar stays compact and uncluttered

  Scenario: Toolbar shows a single export menu button containing the three actions
    Given the real index.html toolbar markup
    Then there should be an export menu button
    And the dropdown should contain items "exportWordBtn", "exportPdfBtn" and "shareBtn"
    And the three items should no longer be standalone toolbar buttons

  Scenario: Clicking the export menu button opens the dropdown
    Given a toolbar export dropdown
    When the user clicks the export menu button
    Then the dropdown should be open

  Scenario: Clicking the export menu button again closes the dropdown
    Given a toolbar export dropdown
    And the dropdown is open
    When the user clicks the export menu button
    Then the dropdown should be closed

  Scenario: Clicking a menu item closes the dropdown
    Given a toolbar export dropdown
    And the dropdown is open
    When the user clicks the "exportPdfBtn" menu item
    Then the dropdown should be closed

  Scenario: Clicking outside the dropdown closes it
    Given a toolbar export dropdown
    And the dropdown is open
    When the user clicks outside the dropdown
    Then the dropdown should be closed

  Scenario: Pressing Escape closes the dropdown
    Given a toolbar export dropdown
    And the dropdown is open
    When the user presses Escape
    Then the dropdown should be closed
