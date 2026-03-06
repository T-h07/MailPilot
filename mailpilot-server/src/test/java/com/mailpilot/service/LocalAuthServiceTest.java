package com.mailpilot.service;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.errors.UnauthorizedException;
import com.mailpilot.repository.LocalAuthRepository;
import com.mailpilot.repository.LocalAuthRepository.LocalAuthRow;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class LocalAuthServiceTest {

  @Test
  void changePasswordUpdatesHashWhenCurrentPasswordMatches() {
    LocalAuthRepository repository = Mockito.mock(LocalAuthRepository.class);
    BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    String currentHash = encoder.encode("current-password");
    when(repository.getLocalAuth())
        .thenReturn(Optional.of(new LocalAuthRow(currentHash, "bcrypt")));

    LocalAuthService service = new LocalAuthService(repository);
    service.changePassword("current-password", "new-password-1", "new-password-1");

    verify(repository).updatePasswordHash(anyString(), Mockito.eq("bcrypt"));
  }

  @Test
  void changePasswordRejectsInvalidCurrentPassword() {
    LocalAuthRepository repository = Mockito.mock(LocalAuthRepository.class);
    BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    String currentHash = encoder.encode("current-password");
    when(repository.getLocalAuth())
        .thenReturn(Optional.of(new LocalAuthRow(currentHash, "bcrypt")));

    LocalAuthService service = new LocalAuthService(repository);

    assertThrows(
        UnauthorizedException.class,
        () -> service.changePassword("wrong-password", "new-password-1", "new-password-1"));
    verify(repository, never()).updatePasswordHash(anyString(), anyString());
  }

  @Test
  void changePasswordRejectsMismatchedConfirmation() {
    LocalAuthRepository repository = Mockito.mock(LocalAuthRepository.class);
    BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    String currentHash = encoder.encode("current-password");
    when(repository.getLocalAuth())
        .thenReturn(Optional.of(new LocalAuthRow(currentHash, "bcrypt")));

    LocalAuthService service = new LocalAuthService(repository);

    assertThrows(
        ApiBadRequestException.class,
        () -> service.changePassword("current-password", "new-password-1", "new-password-2"));
    verify(repository, never()).updatePasswordHash(anyString(), anyString());
  }

  @Test
  void changePasswordRejectsShortNewPassword() {
    LocalAuthRepository repository = Mockito.mock(LocalAuthRepository.class);
    BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    String currentHash = encoder.encode("current-password");
    when(repository.getLocalAuth())
        .thenReturn(Optional.of(new LocalAuthRow(currentHash, "bcrypt")));

    LocalAuthService service = new LocalAuthService(repository);

    assertThrows(
        ApiBadRequestException.class,
        () -> service.changePassword("current-password", "short", "short"));
    verify(repository, never()).updatePasswordHash(anyString(), anyString());
  }
}
