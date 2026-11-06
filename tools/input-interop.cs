// tools/input-interop.cs -- the native surface the input recorder needs.
//
// Compiled at runtime by record-input.ps1 into a small assembly under
// %LOCALAPPDATA%\dsh-incident-studio\ (cached), then loaded with Assembly.LoadFile.
//
// Why not `Add-Type -MemberDefinition`: that helper compiles to a random
// %TEMP%\<name>.dll and deletes it again; on machines with an AV minifilter
// (or a host sandbox that guards executable files in temp) the create/replace
// step fails with "Access to the path ... is denied" and the type never
// appears. An explicit -OutputAssembly path is deterministic and reusable.
//
// Design notes:
//   * polling only -- GetAsyncKeyState is the "current state" API; no hooks,
//     nothing is injected, and no keystroke text can be reconstructed;
//   * one array-returning call per tick keeps the PowerShell loop cheap;
//   * the key table lives here so the recorder, the tests and the plugin UI
//     all see the same names;
//   * keep this file C# 5 / ASCII-only: it is compiled by the .NET Framework
//     CodeDom provider that Windows PowerShell 5.1 uses.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DshIncidentStudio
{
	/// <summary>Native input surface for tools/record-input.ps1.</summary>
	public static class InputInterop
	{
		/// <summary>Bumped whenever the table or the method surface changes.</summary>
		public const int SchemaVersion = 1;

		[DllImport("user32.dll")]
		private static extern short GetAsyncKeyState(int vKey);

		[DllImport("user32.dll")]
		private static extern IntPtr GetForegroundWindow();

		[DllImport("user32.dll")]
		private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

		[DllImport("kernel32.dll")]
		private static extern void GetSystemTimePreciseAsFileTime(out long filetime);

		/// <summary>Virtual-key codes in table order.</summary>
		public static readonly int[] VirtualKeys;

		/// <summary>Display names, same order as <see cref="VirtualKeys"/>.</summary>
		public static readonly string[] KeyNames;

		/// <summary>Index of the first mouse button inside <see cref="VirtualKeys"/>.</summary>
		public static readonly int MouseButtonStart;

		static InputInterop()
		{
			List<int> vks = new List<int>(128);
			List<string> names = new List<string>(128);

			for (int code = 0x41; code <= 0x5A; code += 1)
			{
				vks.Add(code);
				names.Add(((char)code).ToString());
			}
			for (int digit = 0; digit <= 9; digit += 1)
			{
				vks.Add(0x30 + digit);
				names.Add(digit.ToString());
			}
			for (int index = 1; index <= 12; index += 1)
			{
				vks.Add(0x6F + index);
				names.Add("F" + index.ToString());
			}

			Add(vks, names, 0xA0, "LShift");
			Add(vks, names, 0xA1, "RShift");
			Add(vks, names, 0xA2, "LCtrl");
			Add(vks, names, 0xA3, "RCtrl");
			Add(vks, names, 0xA4, "LAlt");
			Add(vks, names, 0xA5, "RAlt");
			Add(vks, names, 0x5B, "LWin");
			Add(vks, names, 0x5C, "RWin");
			Add(vks, names, 0x14, "CapsLock");
			Add(vks, names, 0x90, "NumLock");
			Add(vks, names, 0x91, "ScrollLock");
			Add(vks, names, 0x20, "Space");
			Add(vks, names, 0x0D, "Enter");
			Add(vks, names, 0x1B, "Esc");
			Add(vks, names, 0x08, "Backspace");
			Add(vks, names, 0x09, "Tab");
			Add(vks, names, 0x2D, "Insert");
			Add(vks, names, 0x2E, "Delete");
			Add(vks, names, 0x24, "Home");
			Add(vks, names, 0x23, "End");
			Add(vks, names, 0x21, "PgUp");
			Add(vks, names, 0x22, "PgDn");
			Add(vks, names, 0x25, "Left");
			Add(vks, names, 0x26, "Up");
			Add(vks, names, 0x27, "Right");
			Add(vks, names, 0x28, "Down");
			Add(vks, names, 0xBA, "Semicolon");
			Add(vks, names, 0xBB, "Equal");
			Add(vks, names, 0xBC, "Comma");
			Add(vks, names, 0xBD, "Minus");
			Add(vks, names, 0xBE, "Period");
			Add(vks, names, 0xBF, "Slash");
			Add(vks, names, 0xC0, "Backquote");
			Add(vks, names, 0xDB, "BracketLeft");
			Add(vks, names, 0xDC, "Backslash");
			Add(vks, names, 0xDD, "BracketRight");
			Add(vks, names, 0xDE, "Quote");
			Add(vks, names, 0x2C, "PrintScreen");
			Add(vks, names, 0x13, "Pause");
			for (int num = 0; num <= 9; num += 1)
			{
				Add(vks, names, 0x60 + num, "Num" + num.ToString());
			}
			Add(vks, names, 0x6A, "NumMultiply");
			Add(vks, names, 0x6B, "NumAdd");
			Add(vks, names, 0x6C, "NumSeparator");
			Add(vks, names, 0x6D, "NumSubtract");
			Add(vks, names, 0x6E, "NumDecimal");
			Add(vks, names, 0x6F, "NumDivide");

			// Mouse buttons share the GetAsyncKeyState surface; the recorder needs
			// to know where they begin so it can attach screen coordinates.
			MouseButtonStart = vks.Count;
			Add(vks, names, 0x01, "MouseLeft");
			Add(vks, names, 0x02, "MouseRight");
			Add(vks, names, 0x04, "MouseMiddle");
			Add(vks, names, 0x05, "MouseX1");
			Add(vks, names, 0x06, "MouseX2");

			VirtualKeys = vks.ToArray();
			KeyNames = names.ToArray();
		}

		private static void Add(List<int> vks, List<string> names, int vk, string name)
		{
			vks.Add(vk);
			names.Add(name);
		}

		/// <summary>Wall-clock milliseconds (100ns resolution, same clock as JS Date.now).</summary>
		public static long NowMs()
		{
			long filetime;
			GetSystemTimePreciseAsFileTime(out filetime);
			return (filetime - 116444736000000000L) / 10000L;
		}

		/// <summary>Process id that owns the foreground window (0 when none).</summary>
		public static int ForegroundPid()
		{
			uint pid;
			GetWindowThreadProcessId(GetForegroundWindow(), out pid);
			return (int)pid;
		}

		/// <summary>1 for every key currently down, in VirtualKeys order.</summary>
		public static byte[] ReadState()
		{
			byte[] result = new byte[VirtualKeys.Length];
			for (int index = 0; index < VirtualKeys.Length; index += 1)
			{
				result[index] = (byte)((GetAsyncKeyState(VirtualKeys[index]) & 0x8000) != 0 ? 1 : 0);
			}
			return result;
		}

		/// <summary>Read an arbitrary key list (used by the self test).</summary>
		public static byte[] ReadStateFor(int[] vks)
		{
			byte[] result = new byte[vks.Length];
			for (int index = 0; index < vks.Length; index += 1)
			{
				result[index] = (byte)((GetAsyncKeyState(vks[index]) & 0x8000) != 0 ? 1 : 0);
			}
			return result;
		}
	}
}
