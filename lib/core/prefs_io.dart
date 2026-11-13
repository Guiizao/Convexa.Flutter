import 'prefs.dart';

class PrefsImpl implements Prefs {
  final _mem = <String, String>{};

  @override
  String? read(String key) => _mem[key];

  @override
  void write(String key, String value) => _mem[key] = value;
}
