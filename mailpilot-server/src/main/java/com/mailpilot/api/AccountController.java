package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.AccountDeleteResponse;
import com.mailpilot.api.model.AccountLabelUpdateRequest;
import com.mailpilot.api.model.AccountResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.AccountService;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

  private final AccountService accountService;

  public AccountController(AccountService accountService) {
    this.accountService = accountService;
  }

  @GetMapping
  public List<AccountResponse> listAccounts() {
    return accountService.listAccounts();
  }

  @DeleteMapping("/{accountId}")
  public AccountDeleteResponse detachAccount(
    @PathVariable("accountId") UUID accountId,
    @RequestParam(name = "purge", defaultValue = "false") boolean purge
  ) {
    UUID deletedAccountId = accountService.detachAccount(accountId, purge);
    return new AccountDeleteResponse("ok", deletedAccountId);
  }

  @PatchMapping("/{accountId}/label")
  public StatusResponse updateLabel(
    @PathVariable("accountId") UUID accountId,
    @RequestBody AccountLabelUpdateRequest request
  ) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }
    accountService.updateLabel(accountId, request.role(), request.customLabel());
    return new StatusResponse("ok");
  }
}
