package com.mailpilot.config;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@Profile({"dev", "desktop"})
public class DevCorsConfig implements WebMvcConfigurer {

  private final Environment environment;
  private final DevRequestTimingInterceptor devRequestTimingInterceptor;

  public DevCorsConfig(
      Environment environment,
      @Autowired(required = false) DevRequestTimingInterceptor devRequestTimingInterceptor) {
    this.environment = environment;
    this.devRequestTimingInterceptor = devRequestTimingInterceptor;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    if (isDesktopProfileActive()) {
      registry
          .addMapping("/api/**")
          .allowedOriginPatterns("*")
          .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
          .allowedHeaders("*");
      return;
    }

    registry
        .addMapping("/api/**")
        .allowedOrigins("http://localhost:1420", "http://127.0.0.1:1420")
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .allowedHeaders("*");
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    if (devRequestTimingInterceptor == null) {
      return;
    }
    registry.addInterceptor(devRequestTimingInterceptor).addPathPatterns("/api/**");
  }

  private boolean isDesktopProfileActive() {
    return Arrays.stream(environment.getActiveProfiles())
        .anyMatch(profile -> "desktop".equalsIgnoreCase(profile));
  }
}
