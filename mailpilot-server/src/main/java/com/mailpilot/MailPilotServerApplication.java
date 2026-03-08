package com.mailpilot;

import com.mailpilot.config.DesktopRuntimeBootstrap;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MailPilotServerApplication {

  public static void main(String[] args) {
    DesktopRuntimeBootstrap.configureIfNeeded(args);
    SpringApplication.run(MailPilotServerApplication.class, args);
  }
}
