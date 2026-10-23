import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Click Cancel in the sole PinK-owned Windows file dialog. Never targets another app. */
export async function cancelPinkFileDialog(): Promise<void> {
  if (process.platform !== "win32") throw new Error("文件对话框取消仅支持 Windows");
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$pinkIds = @(Get-Process -Name PinK -ErrorAction Stop | Select-Object -ExpandProperty Id)
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
$deadline = [DateTime]::UtcNow.AddSeconds(10)
function Get-PinkFileDialogs {
  $roots = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $pinkIds -contains $_.Current.ProcessId })
  $found = @{}
  foreach ($rootWindow in $roots) {
    if ($rootWindow.Current.ClassName -eq '#32770') { $found[($rootWindow.GetRuntimeId() -join ':')] = $rootWindow }
    foreach ($dialog in $rootWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
      if ($pinkIds -contains $dialog.Current.ProcessId) { $found[($dialog.GetRuntimeId() -join ':')] = $dialog }
    }
  }
  return @($found.Values)
}
do {
  $dialogs = @(Get-PinkFileDialogs)
  if ($dialogs.Count -gt 1) { throw '多个 PinK 文件对话框，无法唯一取消' }
  if ($dialogs.Count -eq 1) {
    $cancelId = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '2')
    $buttonType = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $cancelCondition = [System.Windows.Automation.AndCondition]::new($cancelId, $buttonType)
    $buttons = @($dialogs[0].FindAll([System.Windows.Automation.TreeScope]::Descendants, $cancelCondition))
    if ($buttons.Count -ne 1) { throw 'PinK 文件对话框无法唯一确认 Cancel 按钮' }
    $button = $buttons[0]
    $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    $closeDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
      if (@(Get-PinkFileDialogs).Count -eq 0) { exit 0 }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $closeDeadline)
    throw 'PinK文件对话框取消后仍未关闭；不继续输入'
  }
  Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)
throw '未发现 PinK 文件对话框；未向其他窗口发送操作'
`;
  await promisify(execFile)(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000 },
  );
}
