[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:8082",
  [int]$TimeoutSec = 20,
  [switch]$IncludeMutating
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$SupportsBasicParsing = (Get-Command Invoke-WebRequest).Parameters.ContainsKey("UseBasicParsing")
$SupportsJsonDepth = (Get-Command ConvertFrom-Json).Parameters.ContainsKey("Depth")

function Convert-JsonPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RawJson
  )

  if ($SupportsJsonDepth) {
    return $RawJson | ConvertFrom-Json -Depth 12
  }

  return $RawJson | ConvertFrom-Json
}

function Invoke-ApiCheck {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Area,
    [Parameter(Mandatory = $true)]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [object]$Body = $null,
    [int[]]$AllowedStatuses = @(200)
  )

  $url = "$BaseUrl$Path"
  $jsonBody = $null
  if ($null -ne $Body) {
    $jsonBody = $Body | ConvertTo-Json -Depth 12 -Compress
  }

  $response = $null
  $statusCode = 0
  $responseContent = ""

  try {
    $requestParams = @{
      Uri = $url
      Method = $Method
      TimeoutSec = $TimeoutSec
    }
    if ($SupportsBasicParsing) {
      $requestParams.UseBasicParsing = $true
    }
    if ($null -ne $jsonBody) {
      $requestParams.ContentType = "application/json"
      $requestParams.Body = $jsonBody
    }

    $response = Invoke-WebRequest @requestParams
    $statusCode = [int]$response.StatusCode
    $responseContent = [string]$response.Content
  } catch {
    $webException = $_.Exception
    if ($webException -is [System.Net.WebException] -and $webException.Response) {
      $httpResponse = [System.Net.HttpWebResponse]$webException.Response
      $statusCode = [int]$httpResponse.StatusCode
      $reader = New-Object System.IO.StreamReader($httpResponse.GetResponseStream())
      $responseContent = $reader.ReadToEnd()
      $reader.Close()
    } else {
      throw
    }
  }

  $ok = $AllowedStatuses -contains $statusCode

  $payload = $null
  $message = ""
  if ([string]::IsNullOrWhiteSpace($responseContent)) {
    $message = "<empty>"
  } else {
    try {
      $payload = Convert-JsonPayload -RawJson $responseContent
      if ($payload -and $payload.PSObject.Properties.Name -contains "message") {
        $message = [string]$payload.message
      } elseif ($payload -and $payload.PSObject.Properties.Name -contains "status") {
        $message = [string]$payload.status
      } else {
        $message = "json"
      }
    } catch {
      $message = "<non-json>"
    }
  }

  return [pscustomobject]@{
    Area = $Area
    Method = $Method
    Path = $Path
    Status = $statusCode
    Pass = $ok
    Message = $message
    Payload = $payload
  }
}

function Add-Result {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [System.Collections.Generic.List[object]]$Results,
    [Parameter(Mandatory = $true)]
    [object]$Result
  )

  $Results.Add($Result) | Out-Null
  $state = if ($Result.Pass) { "PASS" } else { "FAIL" }
  Write-Host ("[{0}] {1} {2} -> {3} ({4})" -f $state, $Result.Method, $Result.Path, $Result.Status, $Result.Message)
}

Write-Host ("[MailPilot] API parity smoke against {0}" -f $BaseUrl) -ForegroundColor Cyan

$results = [System.Collections.Generic.List[object]]::new()

$health = Invoke-ApiCheck -Area "startup" -Method "GET" -Path "/api/health"
Add-Result -Results $results -Result $health

$appState = Invoke-ApiCheck -Area "auth" -Method "GET" -Path "/api/app/state"
Add-Result -Results $results -Result $appState

$recovery = Invoke-ApiCheck -Area "auth" -Method "GET" -Path "/api/app/recovery/options"
Add-Result -Results $results -Result $recovery

$accounts = Invoke-ApiCheck -Area "accounts" -Method "GET" -Path "/api/accounts"
Add-Result -Results $results -Result $accounts

$syncStatus = Invoke-ApiCheck -Area "sync" -Method "GET" -Path "/api/sync/status"
Add-Result -Results $results -Result $syncStatus

$oauthConfig = Invoke-ApiCheck -Area "oauth" -Method "GET" -Path "/api/oauth/gmail/config-check"
Add-Result -Results $results -Result $oauthConfig

$badges = Invoke-ApiCheck -Area "badges" -Method "GET" -Path "/api/badges/summary"
Add-Result -Results $results -Result $badges

$dashboard = Invoke-ApiCheck -Area "dashboard" -Method "GET" -Path "/api/dashboard/summary"
Add-Result -Results $results -Result $dashboard

$focusSummary = Invoke-ApiCheck -Area "focus" -Method "GET" -Path "/api/focus/summary"
Add-Result -Results $results -Result $focusSummary

$focusQueue = Invoke-ApiCheck -Area "focus" -Method "GET" -Path "/api/focus/queue?type=NEEDS_REPLY&pageSize=10"
Add-Result -Results $results -Result $focusQueue

$insights = Invoke-ApiCheck -Area "insights" -Method "GET" -Path "/api/insights/summary?range=14d"
Add-Result -Results $results -Result $insights

$views = Invoke-ApiCheck -Area "views" -Method "GET" -Path "/api/views"
Add-Result -Results $results -Result $views

$senderRules = Invoke-ApiCheck -Area "views" -Method "GET" -Path "/api/sender-rules"
Add-Result -Results $results -Result $senderRules

$drafts = Invoke-ApiCheck -Area "drafts" -Method "GET" -Path "/api/drafts?sort=UPDATED_DESC"
Add-Result -Results $results -Result $drafts

$onboardingProposals = Invoke-ApiCheck -Area "onboarding" -Method "GET" -Path "/api/onboarding/view-proposals?maxSenders=20&maxMessages=500"
Add-Result -Results $results -Result $onboardingProposals

$accountIds = @()
if ($accounts.Pass -and $accounts.Payload -is [System.Array]) {
  $accountIds = @($accounts.Payload | ForEach-Object { $_.id } | Where-Object { $_ })
}

$messageId = $null
$threadId = $null
$attachmentId = $null

if ($accountIds.Count -gt 0) {
  $mailboxBody = @{
    scope = @{
      accountIds = @($accountIds[0])
    }
    sort = "RECEIVED_DESC"
    mode = "INBOX"
    pageSize = 25
    cursor = $null
  }

  $mailbox = Invoke-ApiCheck -Area "mailbox" -Method "POST" -Path "/api/mailbox/query" -Body $mailboxBody
  Add-Result -Results $results -Result $mailbox

  if ($mailbox.Pass -and $mailbox.Payload -and $mailbox.Payload.items) {
    $firstMessage = @($mailbox.Payload.items)[0]
    if ($firstMessage) {
      $messageId = [string]$firstMessage.id
    }
  }

  if ($messageId) {
    $messageDetail = Invoke-ApiCheck -Area "mailbox" -Method "GET" -Path "/api/messages/$messageId"
    Add-Result -Results $results -Result $messageDetail

    $bodyLoad = Invoke-ApiCheck -Area "mailbox" -Method "POST" -Path "/api/messages/$messageId/body/load" -Body @{} -AllowedStatuses @(200, 401)
    Add-Result -Results $results -Result $bodyLoad

    if ($messageDetail.Pass -and $messageDetail.Payload) {
      $threadId = [string]$messageDetail.Payload.threadId
      $attachments = @($messageDetail.Payload.attachments)
      if ($attachments.Count -gt 0) {
        $attachmentId = [string]$attachments[0].id
      }
    }

    $messagePdf = Invoke-ApiCheck -Area "exports" -Method "GET" -Path "/api/messages/$messageId/export/pdf" -AllowedStatuses @(200, 401)
    Add-Result -Results $results -Result $messagePdf

    if ($threadId) {
      $threadPdf = Invoke-ApiCheck -Area "exports" -Method "GET" -Path "/api/threads/$threadId/export/pdf" -AllowedStatuses @(200, 401)
      Add-Result -Results $results -Result $threadPdf
    }

    if ($attachmentId) {
      $attachment = Invoke-ApiCheck -Area "attachments" -Method "GET" -Path "/api/attachments/$attachmentId/download" -AllowedStatuses @(200, 401)
      Add-Result -Results $results -Result $attachment
    }
  }
}

if ($IncludeMutating) {
  $markInboxOpened = Invoke-ApiCheck -Area "badges" -Method "POST" -Path "/api/badges/inbox/opened" -Body @{}
  Add-Result -Results $results -Result $markInboxOpened

  if ($messageId) {
    $markSeen = Invoke-ApiCheck -Area "mailbox" -Method "POST" -Path "/api/messages/$messageId/seen" -Body @{}
    Add-Result -Results $results -Result $markSeen
  }
}

$failed = @($results | Where-Object { -not $_.Pass })

Write-Host ""
Write-Host "[MailPilot] Summary" -ForegroundColor Cyan
Write-Host ("Total checks: {0}" -f $results.Count)
Write-Host ("Passed: {0}" -f ($results.Count - $failed.Count))
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "[MailPilot] Failed checks:" -ForegroundColor Yellow
  $failed |
    Select-Object Area, Method, Path, Status, Message |
    Format-Table -AutoSize
  exit 1
}
