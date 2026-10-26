package logic

func validCategory(c string) bool {
	switch c {
	case "软件", "设计", "数据", "文档", "其他":
		return true
	}
	return false
}
