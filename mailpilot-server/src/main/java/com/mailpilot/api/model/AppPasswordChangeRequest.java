package com.mailpilot.api.model;

public record AppPasswordChangeRequest(
    String currentPassword, String newPassword, String confirmNewPassword) {}
