package com.mailpilot.api.model;

public record AppRecoveryVerifyRequest(String code, String newPassword, String confirmNewPassword) {}
