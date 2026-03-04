package com.mailpilot.api.dev;

import com.mailpilot.service.DevSeedService;
import com.mailpilot.service.DevSeedService.SeedResult;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Profile("dev")
@RestController
@RequestMapping("/api/dev")
public class DevSeedController {

  private final DevSeedService devSeedService;

  public DevSeedController(DevSeedService devSeedService) {
    this.devSeedService = devSeedService;
  }

  @PostMapping("/seed")
  public SeedResult seed() {
    return devSeedService.seedMailboxData();
  }
}
