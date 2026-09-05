#include <napi.h>

typedef struct TSLanguage TSLanguage;
extern "C" TSLanguage *tree_sitter_gitlab_ci();

const napi_type_tag LANGUAGE_TYPE_TAG = {0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16};

Napi::Object Language(Napi::Env env, TSLanguage *parser, const char *name) {
  auto result = Napi::Object::New(env);
  auto language = Napi::External<TSLanguage>::New(env, parser);
  language.TypeTag(&LANGUAGE_TYPE_TAG);
  result["name"] = Napi::String::New(env, name);
  result["language"] = language;
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object) {
  return Language(env, tree_sitter_gitlab_ci(), "gitlab_ci");
}

NODE_API_MODULE(tree_sitter_gitlab_ci_binding, Init)
