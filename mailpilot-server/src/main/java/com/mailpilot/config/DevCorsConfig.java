package com.mailpilot.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@Profile("dev")
public class DevCorsConfig implements WebMvcConfigurer {

  private final DevRequestTimingInterceptor devRequestTimingInterceptor;

  public DevCorsConfig(DevRequestTimingInterceptor devRequestTimingInterceptor) {
    this.devRequestTimingInterceptor = devRequestTimingInterceptor;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry
        .addMapping("/api/**")
        .allowedOrigins("http://localhost:1420", "http://127.0.0.1:1420")
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .allowedHeaders("*");
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(devRequestTimingInterceptor).addPathPatterns("/api/**");
  }
}
