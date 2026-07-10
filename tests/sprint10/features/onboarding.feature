Feature: First-time onboarding guide

  As a first-time user of Typora Next
  I want a guided tour of the toolbar
  So that I can understand the icons without guessing

  Scenario: First launch shows the welcome dialog
    Given the user has never seen the onboarding guide
    When the app finishes initialising
    Then a welcome dialog should appear asking if the user wants a tour

  Scenario: User accepts the tour and sees toolbar steps
    Given the welcome dialog is visible
    When the user clicks the start tour button
    Then the tour should start with the toolbar section intro
    And the first toolbar button should be highlighted

  Scenario: User can navigate through toolbar steps
    Given the tour is in the toolbar section
    When the user clicks the next button repeatedly
    Then each toolbar button should be highlighted in order

  Scenario: User can skip the onboarding guide
    Given the welcome dialog is visible
    When the user clicks the skip button
    Then the onboarding overlay should be hidden
    And the onboarding seen flag should be set

  Scenario: Onboarding does not appear on second launch
    Given the user has already seen the onboarding guide
    When the app finishes initialising
    Then no onboarding dialog should appear

  Scenario: User can restart onboarding from settings
    Given the user has already seen the onboarding guide
    When the user clicks restart onboarding in settings
    Then the welcome dialog should appear
