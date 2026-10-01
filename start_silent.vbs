Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
venvPythonw = currentDir & "\.venv\Scripts\pythonw.exe"
runApp = currentDir & "\run_app.pyw"

If fso.FileExists(venvPythonw) Then
    cmd = """" & venvPythonw & """ """ & runApp & """"
Else
    cmd = "pythonw """ & runApp & """"
End If

WshShell.CurrentDirectory = currentDir
WshShell.Run cmd, 0, False
