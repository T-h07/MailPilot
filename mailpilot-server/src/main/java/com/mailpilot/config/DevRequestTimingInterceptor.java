package com.mailpilot.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
@Profile("dev")
public class DevRequestTimingInterceptor implements HandlerInterceptor {

  private static final Logger LOGGER = LoggerFactory.getLogger(DevRequestTimingInterceptor.class);
  private static final String START_NS_ATTRIBUTE = "mailpilot.dev.requestStartNs";

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    request.setAttribute(START_NS_ATTRIBUTE, System.nanoTime());
    return true;
  }

  @Override
  public void afterCompletion(
      HttpServletRequest request,
      HttpServletResponse response,
      Object handler,
      Exception exception) {
    Object startValue = request.getAttribute(START_NS_ATTRIBUTE);
    if (!(startValue instanceof Long startNs)) {
      return;
    }
    long durationMs = (System.nanoTime() - startNs) / 1_000_000;
    String method = request.getMethod();
    String path = request.getRequestURI();
    int status = response.getStatus();
    LOGGER.info(
        "api_timing method={} path={} status={} durationMs={}", method, path, status, durationMs);
  }
}
