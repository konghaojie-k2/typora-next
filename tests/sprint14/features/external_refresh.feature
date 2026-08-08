Feature: External file refresh (background-tab detection + manual refresh)

  As a user with multiple tabs open
  I want stale background tabs detected when I switch back, plus a manual refresh entry
  So that I never unknowingly read content that changed on disk

  Scenario: Switching back to a tab whose file changed on disk prompts refresh
    Given an open tab whose cached content differs from disk
    And no refresh prompt is currently visible
    When the external refresh decision is evaluated
    Then a refresh prompt should be shown

  Scenario: Unchanged content stays silent when switching back
    Given an open tab whose cached content matches disk
    When the external refresh decision is evaluated
    Then no refresh prompt should be shown

  Scenario: A visible prompt is not duplicated
    Given an open tab whose cached content differs from disk
    And a refresh prompt is currently visible
    When the external refresh decision is evaluated
    Then no refresh prompt should be shown

  Scenario: A failed disk read never prompts
    Given an open tab whose file cannot be read from disk
    When the external refresh decision is evaluated
    Then no refresh prompt should be shown

  Scenario: The toolbar exposes a manual refresh entry
    Given the real index.html markup
    Then the toolbar should contain a refresh file button
    And the page should load the external refresh module
