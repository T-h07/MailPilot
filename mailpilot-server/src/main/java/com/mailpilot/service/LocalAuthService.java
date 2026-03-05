package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.errors.UnauthorizedException;
import com.mailpilot.repository.LocalAuthRepository;
import com.mailpilot.repository.LocalAuthRepository.LocalAuthRow;
import java.util.Optional;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class LocalAuthService {

  private static final int MIN_PASSWORD_LENGTH = 8;
  private static final int MAX_PASSWORD_LENGTH = 128;

  private final LocalAuthRepository localAuthRepository;
  private final PasswordEncoder passwordEncoder;

  public LocalAuthService(LocalAuthRepository localAuthRepository) {
    this.localAuthRepository = localAuthRepository;
    this.passwordEncoder = new BCryptPasswordEncoder();
  }

  public boolean hasPassword() {
    return localAuthRepository.hasPassword();
  }

  public void setPassword(String rawPassword) {
    setPassword(rawPassword, false);
  }

  public void setPassword(String rawPassword, boolean allowOverwrite) {
    String normalizedPassword = normalizePassword(rawPassword);
    String hash = passwordEncoder.encode(normalizedPassword);

    if (localAuthRepository.hasPassword()) {
      if (!allowOverwrite) {
        throw new ApiConflictException("Password already set.");
      }
      localAuthRepository.updatePasswordHash(hash, "bcrypt");
      return;
    }

    localAuthRepository.insertPasswordHash(hash, "bcrypt");
  }

  public void verifyPassword(String rawPassword) {
    String normalizedPassword = normalizePassword(rawPassword);
    Optional<LocalAuthRow> localAuth = localAuthRepository.getLocalAuth();
    if (localAuth.isEmpty()) {
      throw new ApiBadRequestException("Password is not set.");
    }

    if (!passwordEncoder.matches(normalizedPassword, localAuth.get().passwordHash())) {
      throw new UnauthorizedException("Invalid password");
    }
  }

  private String normalizePassword(String rawPassword) {
    if (!StringUtils.hasText(rawPassword)) {
      throw new ApiBadRequestException("Password is required.");
    }

    String normalized = rawPassword.trim();
    if (normalized.length() < MIN_PASSWORD_LENGTH || normalized.length() > MAX_PASSWORD_LENGTH) {
      throw new ApiBadRequestException("Password must be between 8 and 128 characters.");
    }
    return normalized;
  }
}
