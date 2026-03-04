package com.mailpilot.service.oauth;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class TokenCrypto {

  private static final String ENCRYPTION_VERSION = "v1";
  private static final String CIPHER_ALGORITHM = "AES/GCM/NoPadding";
  private static final int IV_SIZE_BYTES = 12;
  private static final int TAG_SIZE_BITS = 128;

  private final SecretKeySpec secretKey;
  private final SecureRandom secureRandom = new SecureRandom();

  public TokenCrypto(TokenKeyProvider tokenKeyProvider) {
    this.secretKey = new SecretKeySpec(tokenKeyProvider.key(), "AES");
  }

  public String encrypt(String plaintext) {
    if (!StringUtils.hasText(plaintext)) {
      throw new IllegalArgumentException("Token plaintext is required");
    }

    byte[] iv = new byte[IV_SIZE_BYTES];
    secureRandom.nextBytes(iv);

    try {
      Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
      cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(TAG_SIZE_BITS, iv));
      byte[] encryptedBytes = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

      byte[] payload = new byte[iv.length + encryptedBytes.length];
      System.arraycopy(iv, 0, payload, 0, iv.length);
      System.arraycopy(encryptedBytes, 0, payload, iv.length, encryptedBytes.length);

      return ENCRYPTION_VERSION + ":" + Base64.getEncoder().encodeToString(payload);
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Failed to encrypt OAuth token", exception);
    }
  }
}
