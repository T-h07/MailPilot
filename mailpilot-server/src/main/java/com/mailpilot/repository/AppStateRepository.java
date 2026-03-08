package com.mailpilot.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AppStateRepository {

  private final JdbcTemplate jdbcTemplate;

  public AppStateRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public AppStateRow getAppState() {
    ensureAppStateRow();
    return jdbcTemplate.queryForObject(
        """
      SELECT onboarding_complete, locked, onboarding_step
      FROM app_state
      WHERE id = 1
      """,
        (resultSet, rowNum) ->
            new AppStateRow(
                resultSet.getBoolean("onboarding_complete"),
                resultSet.getBoolean("locked"),
                resultSet.getInt("onboarding_step")));
  }

  public UserProfileRow getUserProfile() {
    ensureUserProfileRow();
    return jdbcTemplate.queryForObject(
        """
      SELECT first_name, last_name, field_of_work
      FROM user_profile
      WHERE id = 1
      """,
        (resultSet, rowNum) ->
            new UserProfileRow(
                resultSet.getString("first_name"),
                resultSet.getString("last_name"),
                resultSet.getString("field_of_work")));
  }

  public void setLocked(boolean locked) {
    ensureAppStateRow();
    jdbcTemplate.update(
        """
      UPDATE app_state
      SET locked = ?, updated_at = now()
      WHERE id = 1
      """,
        locked);
  }

  public void setOnboardingStep(int step) {
    ensureAppStateRow();
    jdbcTemplate.update(
        """
      UPDATE app_state
      SET onboarding_step = ?, onboarding_updated_at = now(), updated_at = now()
      WHERE id = 1
      """,
        step);
  }

  public void markOnboardingCompleted() {
    ensureAppStateRow();
    jdbcTemplate.update(
        """
      UPDATE app_state
      SET onboarding_complete = true,
          onboarding_step = 6,
          onboarding_updated_at = now(),
          updated_at = now(),
          locked = false
      WHERE id = 1
      """);
  }

  public void updateUserProfile(String firstName, String lastName, String fieldOfWork) {
    ensureUserProfileRow();
    jdbcTemplate.update(
        """
      UPDATE user_profile
      SET first_name = ?, last_name = ?, field_of_work = ?, updated_at = now()
      WHERE id = 1
      """,
        firstName,
        lastName,
        fieldOfWork);
  }

  private void ensureAppStateRow() {
    jdbcTemplate.update(
        """
      INSERT INTO app_state (id, onboarding_complete, locked, onboarding_step)
      VALUES (1, false, false, 1)
      ON CONFLICT (id) DO NOTHING
      """);
  }

  private void ensureUserProfileRow() {
    jdbcTemplate.update(
        """
      INSERT INTO user_profile (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
      """);
  }

  public record AppStateRow(boolean onboardingComplete, boolean locked, int onboardingStep) {}

  public record UserProfileRow(String firstName, String lastName, String fieldOfWork) {}
}
